from __future__ import annotations

import asyncio
from collections import defaultdict
from uuid import UUID

from app.api.errors import ApiError
from app.repositories.protocols import RetryKind, RoundRepositoryProtocol
from app.schemas.research import CreateQuestionnaire, QuestionnaireView
from app.schemas.rounds import RoundSnapshot
from app.schemas.survey import (
    DialogMessage,
    InferenceEvidence,
    InferenceResult,
    InterviewSession,
    RespondentProfile,
    SentimentData,
    SurveyProgress,
    SurveyResponse,
)
from app.services.analytics_service import AnalyticsService
from app.services.exception_service import ExceptionService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
from app.services.research_service import ResearchService
from app.services.round_executor import RoundExecutor
from app.services.simulation_engine import SimulationEngine


ACTION_BY_STATUS: dict[str, list[str]] = {
    "queued": ["pause", "cancel"],
    "running": ["pause", "cancel"],
    "pausing": ["cancel"],
    "paused": ["resume", "cancel"],
    "completed": [],
    "completed_with_errors": ["retry_failed"],
    "failed": [],
    "cancelled": ["retry_incomplete"],
}


class RunService:
    def __init__(
        self,
        repository: RoundRepositoryProtocol,
        research: ResearchService,
        engine: SimulationEngine,
        analytics: AnalyticsService,
        inference: InferenceService | None = None,
        inference_analysis: InferenceAnalysisService | None = None,
        executor: RoundExecutor | None = None,
        exception_service: ExceptionService | None = None,
    ) -> None:
        self.repository = repository
        self.research = research
        self.engine = engine
        self.analytics = analytics
        self.inference = inference or InferenceService()
        self.inference_analysis = inference_analysis or InferenceAnalysisService()
        self.exception_service = exception_service or ExceptionService()
        self.executor = executor or RoundExecutor(
            repository,
            research,
            engine,
            self.inference,
        )

    async def create(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        locale: str,
    ) -> RoundSnapshot:
        questionnaire = await self.research.get_questionnaire(
            owner_id,
            questionnaire_id,
        )
        frozen = await self.research.freeze_config(owner_id, questionnaire_id)
        profiles = self.engine.generate_respondents(
            frozen.config.respondentConfigs,
            locale,
        )
        row = await self.repository.create_round(
            owner_id,
            {
                "project_id": questionnaire.project_id,
                "questionnaire_id": questionnaire.id,
                "config_version_id": frozen.config_version_id,
                "name": frozen.config.title,
                "mode": questionnaire.mode,
                "locale": locale,
                "respondents": [
                    {
                        "profile_json": profile.model_dump(mode="json"),
                        "total_questions": len(frozen.config.questions),
                    }
                    for profile in profiles
                ],
            },
        )
        await self.executor.start(row.id)
        return await self.get(owner_id, row.id)

    async def get(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> RoundSnapshot:
        normalized_id = _uuid(round_id)
        rows = await self.repository.get_result_rows_for_owner(
            owner_id,
            normalized_id,
        )
        if rows is None:
            raise _not_found()
        config = await self.research.get_config_version(
            owner_id,
            rows.round.config_version_id,
        )
        return self._snapshot(rows, config)

    async def list_for_project(
        self,
        owner_id: UUID,
        project_id: UUID | str,
    ) -> list[RoundSnapshot]:
        normalized_project_id = _uuid(project_id)
        await self.research.get_project(owner_id, normalized_project_id)
        rows = await self.repository.list_rounds_for_owner(owner_id)
        return [
            await self.get(owner_id, row.id)
            for row in rows
            if row.project_id == normalized_project_id
        ]

    async def pause(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> RoundSnapshot:
        row, _transitioned = await self._transition_active(
            owner_id,
            round_id,
            frozenset({"queued", "running"}),
            lambda status: "paused" if status == "queued" else "pausing",
        )
        return await self.get(owner_id, row.id)

    async def resume(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> RoundSnapshot:
        row = await self._row(owner_id, round_id)
        if row.status != "paused":
            raise _invalid_transition(row.status)
        try:
            await self.executor.start(row.id)
        except RuntimeError:
            return await self._raise_latest_transition(owner_id, row.id)
        return await self.get(owner_id, row.id)

    async def cancel(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> RoundSnapshot:
        row, _transitioned = await self._transition_active(
            owner_id,
            round_id,
            frozenset({"queued", "running", "pausing", "paused"}),
            lambda _status: "cancelled",
        )
        return await self.get(owner_id, row.id)

    async def retry(
        self,
        owner_id: UUID,
        round_id: UUID | str,
        kind: RetryKind,
    ) -> RoundSnapshot:
        source = await self._row(owner_id, round_id)
        retryable = await self.repository.list_retryable_respondents_for_owner(
            owner_id,
            source.id,
            kind,
        )
        if not retryable:
            raise ApiError(
                422,
                "NO_RETRYABLE_RESPONDENTS",
                "The round has no respondents matching this retry kind",
            )
        expected_status = (
            "completed_with_errors" if kind == "failed" else "cancelled"
        )
        if source.status != expected_status:
            raise _invalid_transition(source.status)
        await self.research.get_config_version(owner_id, source.config_version_id)
        row = await self.repository.create_round(
            owner_id,
            {
                "project_id": source.project_id,
                "questionnaire_id": source.questionnaire_id,
                "config_version_id": source.config_version_id,
                "name": f"{source.name} ({kind} retry)",
                "mode": source.mode,
                "locale": source.locale,
                "retry_of_round_id": source.id,
                "retry_kind": kind,
                "respondents": [
                    {
                        "profile_json": row.profile_json,
                        "source_respondent_id": row.id,
                        "total_questions": row.total_questions,
                    }
                    for row in retryable
                ],
            },
        )
        await self.executor.start(row.id)
        return await self.get(owner_id, row.id)

    async def copy(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> QuestionnaireView:
        source = await self._row(owner_id, round_id)
        config_version = await self.research.get_config_version(
            owner_id,
            source.config_version_id,
        )
        return await self.research.create_questionnaire(
            owner_id,
            source.project_id,
            CreateQuestionnaire(
                mode=source.mode,
                config=config_version.full_snapshot.model_copy(deep=True),
                schemaVersion=config_version.schema_version,
            ),
        )

    async def wait(self, round_id: UUID | str) -> RoundSnapshot:
        row = await self.executor.wait(round_id)
        owner_id = await self.repository.get_owner_id(row.id)
        if owner_id is None:
            raise KeyError(row.id)
        return await self.get(owner_id, row.id)

    async def wait_for_status(
        self,
        owner_id: UUID,
        round_id: UUID | str,
        status: str,
        *,
        timeout: float = 2,
    ) -> RoundSnapshot:
        async def poll() -> RoundSnapshot:
            while True:
                snapshot = await self.get(owner_id, round_id)
                if snapshot.status == status:
                    return snapshot
                if snapshot.status in {
                    "completed",
                    "completed_with_errors",
                    "failed",
                    "cancelled",
                }:
                    raise RuntimeError(
                        f"round reached {snapshot.status} before {status}"
                    )
                await asyncio.sleep(0.005)

        return await asyncio.wait_for(poll(), timeout=timeout)

    async def _row(self, owner_id: UUID, round_id: UUID | str):
        row = await self.repository.get_for_owner(owner_id, _uuid(round_id))
        if row is None:
            raise _not_found()
        return row

    async def _raise_latest_transition(self, owner_id: UUID, round_id: UUID):
        current = await self.repository.get_for_owner(owner_id, round_id)
        if current is None:
            raise _not_found()
        raise _invalid_transition(current.status)

    async def _transition_active(
        self,
        owner_id: UUID,
        round_id: UUID | str,
        allowed_statuses: frozenset[str],
        target_for_status,
    ):
        for _attempt in range(3):
            row = await self._row(owner_id, round_id)
            if row.status not in allowed_statuses:
                raise _invalid_transition(row.status)
            transitioned = await self.repository.transition(
                owner_id,
                row.id,
                row.row_version,
                frozenset({row.status}),
                target_for_status(row.status),
            )
            if transitioned is not None:
                return row, transitioned
        return await self._raise_latest_transition(owner_id, row.id)

    def _snapshot(self, rows, config_view) -> RoundSnapshot:
        config = config_view.full_snapshot
        profiles = [
            RespondentProfile.model_validate(row.profile_json)
            for row in rows.respondents
        ]
        profile_by_row = dict(zip(rows.respondents, profiles, strict=True))
        respondent_by_id = {row.id: row for row in rows.respondents}
        messages_by_session = defaultdict(list)
        for row in rows.messages:
            messages_by_session[row.session_id].append(
                DialogMessage(
                    id=str(row.id),
                    role=row.role,
                    content=row.content,
                    timestamp=row.created_at,
                    questionId=row.question_id,
                    sentiment=row.sentiment,
                    answerValue=row.answer_value_json,
                )
            )
        sessions = []
        for row in rows.sessions:
            respondent = respondent_by_id[row.round_respondent_id]
            profile = profile_by_row[respondent]
            sessions.append(
                InterviewSession(
                    respondentId=profile.id,
                    status=row.status,
                    terminationCode=row.termination_code,
                    terminationReason=row.termination_reason,
                    errorCode=row.error_code,
                    errorMessage=row.error_message,
                    dialog=messages_by_session[row.id],
                    completedQuestions=respondent.completed_questions,
                    totalQuestions=respondent.total_questions,
                    startTime=row.started_at,
                    endTime=row.finished_at,
                )
            )
        responses_by_respondent = defaultdict(dict)
        for row in rows.responses:
            responses_by_respondent[row.round_respondent_id][row.question_id] = (
                row.answer_value_json
            )
        responses = []
        session_by_respondent = {
            row.round_respondent_id: row for row in rows.sessions
        }
        for respondent in rows.respondents:
            profile = profile_by_row[respondent]
            session = session_by_respondent[respondent.id]
            status = (
                session.status
                if session.status
                in {
                    "completed",
                    "terminated_by_respondent",
                    "terminated_by_interviewer",
                }
                else "partial"
            )
            responses.append(
                SurveyResponse(
                    id=f"response-{respondent.id}",
                    surveyId=str(rows.round.id),
                    respondentId=profile.id,
                    answers=responses_by_respondent[respondent.id],
                    status=status,
                    startedAt=session.started_at,
                    finishedAt=session.finished_at,
                )
            )
        inference_results = [
            InferenceResult(
                id=str(row.id),
                runId=str(rows.round.id),
                respondentId=profile_by_row[
                    respondent_by_id[row.round_respondent_id]
                ].id,
                taskId=row.task_id,
                taskName=row.task_name,
                kind=row.kind,
                value=row.value_json,
                reason=row.reason,
                evidence=[
                    InferenceEvidence.model_validate(item)
                    for item in row.evidence_json
                ],
                status=row.status,
                error=row.error_message,
                errorCode=row.error_code,
                errorMessage=row.error_message,
            )
            for row in rows.inference_results
        ]
        active = respondent_by_id.get(rows.round.active_respondent_id)
        active_profile = profile_by_row.get(active) if active is not None else None
        current_index = (
            active.ordinal
            if active is not None
            else sum(
                row.status
                in {
                    "completed",
                    "terminated_by_respondent",
                    "terminated_by_interviewer",
                    "failed",
                }
                for row in rows.respondents
            )
        )
        snapshot = RoundSnapshot(
            id=str(rows.round.id),
            name=rows.round.name,
            mode=rows.round.mode,
            locale=rows.round.locale,
            status=rows.round.status,
            config=config,
            respondents=profiles,
            sessions=sessions,
            progress=SurveyProgress(
                totalRespondents=rows.round.total_respondents,
                completedRespondents=rows.round.completed_respondents,
                inProgressRespondents=sum(
                    row.status == "in_progress" for row in rows.respondents
                ),
                terminatedRespondents=rows.round.terminated_respondents,
                currentRespondentIndex=current_index,
                failedRespondents=rows.round.failed_respondents,
                incompleteRespondents=rows.round.incomplete_respondents,
                answeredQuestions=sum(
                    row.completed_questions for row in rows.respondents
                ),
            ),
            sentiment=SentimentData(positive=0, neutral=0, negative=0),
            questionAnalysis=[],
            demographicAnalysis=[],
            inferenceResults=inference_results,
            inferenceSummary=[],
            responses=responses,
            activeRespondentId=(active_profile.id if active_profile else None),
            createdAt=rows.round.created_at,
            startedAt=rows.round.started_at,
            finishedAt=rows.round.finished_at,
            error=rows.round.error_message,
            projectId=str(rows.round.project_id),
            questionnaireId=str(rows.round.questionnaire_id),
            questionnaireVersionId=str(
                config_view.questionnaire_version_id
            ),
            configVersionId=str(rows.round.config_version_id),
            rowVersion=rows.round.row_version,
            updatedAt=rows.round.updated_at,
            errorCode=rows.round.error_code,
            parentRoundId=(str(rows.round.parent_round_id) if rows.round.parent_round_id else None),
            retryOfRoundId=(
                str(rows.round.retry_of_round_id)
                if rows.round.retry_of_round_id is not None
                else None
            ),
            retryKind=rows.round.retry_kind,
        )
        snapshot.sentiment = self.analytics.analyze_sentiment(sessions)
        snapshot.questionAnalysis = self.analytics.analyze_questions(
            sessions,
            config.questions,
        )
        snapshot.demographicAnalysis = self.analytics.analyze_demographics(
            sessions,
            profiles,
            config.questions,
            rows.round.locale,
        )
        snapshot.inferenceSummary = self.inference_analysis.summarize(
            inference_results
        )
        return snapshot


def _uuid(value: UUID | str) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _not_found() -> ApiError:
    return ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
    )


def _invalid_transition(status: str) -> ApiError:
    return ApiError(
        409,
        "INVALID_RUN_TRANSITION",
        "The requested round transition is not allowed",
        {
            "currentStatus": status,
            "allowedActions": ACTION_BY_STATUS.get(status, []),
        },
    )
