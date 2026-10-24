from __future__ import annotations

import asyncio
import logging
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.db.models import (
    InferenceResultRow,
    MessageRow,
    ResearchRoundRow,
    ResponseRow,
    RoundRespondentRow,
    SessionRow,
)
from app.api.errors import ApiError
from app.db.errors import STORAGE_ERRORS
from app.repositories.protocols import RoundCheckpoint, RoundRepositoryProtocol
from app.schemas.survey import (
    DialogMessage,
    InferenceConfig,
    InterviewSession,
    RespondentProfile,
    SurveyConfig,
)
from app.services.inference_service import InferenceService
from app.services.http_engine import ModelCallError, validate_answer
from app.services.research_service import ResearchService
from app.services.simulation_engine import SimulationEngine


logger = logging.getLogger(__name__)


class RoundExecutor:
    def __init__(
        self,
        repository: RoundRepositoryProtocol,
        research: ResearchService,
        engine: SimulationEngine,
        inference: InferenceService | None = None,
        *,
        lease_seconds: float = 30,
    ) -> None:
        self._repository = repository
        self._research = research
        self._engine = engine
        self._inference = inference or InferenceService()
        self._lease_seconds = max(lease_seconds, getattr(engine, "request_timeout", 0) + 10) if hasattr(engine, "request_timeout") else lease_seconds
        self._lease_owner = f"round-executor-{uuid4()}"
        self._tasks: dict[UUID, asyncio.Task[None]] = {}

    async def start(self, round_id: UUID | str) -> ResearchRoundRow:
        normalized_id = _uuid(round_id)
        owner_id = await self._repository.get_owner_id(normalized_id)
        if owner_id is None:
            raise KeyError(normalized_id)
        existing_task = self._tasks.get(normalized_id)
        if existing_task is not None and not existing_task.done():
            await asyncio.shield(existing_task)
            row = await self._repository.get_for_owner(owner_id, normalized_id)
            if row is None:
                raise KeyError(normalized_id)
            if row.status == "running":
                return row

        current = await self._repository.get_for_owner(owner_id, normalized_id)
        if current is None:
            raise KeyError(normalized_id)
        expected_source = (current.execution_context or {}).get("source", "mock")
        expected_model = (current.execution_context or {}).get("model")
        active_source = getattr(self._engine, "execution_source", {"source": "mock", "model": None})
        if expected_source != active_source["source"] or expected_model != active_source.get("model"):
            raise ApiError(409, "MODEL_SOURCE_CHANGED", "Restore the original model configuration to resume this round")
        leased = await self._repository.acquire_lease(
            owner_id,
            normalized_id,
            self._lease_owner,
            self._lease_expiry(),
            current.row_version,
        )
        if leased is None:
            raise RuntimeError("round execution lease could not be acquired")
        running = await self._repository.transition(
            owner_id,
            normalized_id,
            leased.row_version,
            frozenset({current.status}),
            "running",
        )
        if running is None:
            await self._repository.release_lease(
                owner_id,
                normalized_id,
                self._lease_owner,
                leased.row_version,
            )
            raise RuntimeError("round status changed while starting")
        task = asyncio.create_task(
            self._execute(owner_id, normalized_id)
        )
        self._tasks[normalized_id] = task
        task.add_done_callback(
            lambda completed: self._forget_task(normalized_id, completed)
        )
        return running

    def _forget_task(self, round_id: UUID, task: asyncio.Task[None]) -> None:
        # A completed task must never remove a replacement scheduled by resume.
        if self._tasks.get(round_id) is task:
            del self._tasks[round_id]
        if not task.cancelled() and task.exception() is not None:
            logger.warning("ROUND_EXECUTION_FAILED resource_id=%s", round_id)

    async def wait(self, round_id: UUID | str) -> ResearchRoundRow:
        normalized_id = _uuid(round_id)
        task = self._tasks.get(normalized_id)
        if task is not None:
            await asyncio.shield(task)
        owner_id = await self._repository.get_owner_id(normalized_id)
        if owner_id is None:
            raise KeyError(normalized_id)
        row = await self._repository.get_for_owner(owner_id, normalized_id)
        if row is None:
            raise KeyError(normalized_id)
        return row

    async def reconcile_interrupted_rounds(self):
        return await self._repository.reconcile_interrupted_rounds(
            datetime.now(UTC)
        )

    async def shutdown(self) -> None:
        tasks = tuple(self._tasks.items())
        for _, task in tasks:
            task.cancel()
        await asyncio.gather(*(task for _, task in tasks), return_exceptions=True)
        for round_id, _ in tasks:
            try:
                await self._pause_owned_round(round_id)
            except Exception as error:
                if not _is_storage_failure(error):
                    raise
                logger.warning("STORAGE_UNAVAILABLE resource_id=%s operation=shutdown", round_id)

    async def _pause_owned_round(self, round_id: UUID) -> None:
        owner_id = await self._repository.get_owner_id(round_id)
        if owner_id is None:
            return
        while True:
            current = await self._repository.get_for_owner(owner_id, round_id)
            if (
                current is None
                or current.status not in {"queued", "running", "pausing"}
                or current.lease_owner != self._lease_owner
            ):
                break
            paused = await self._repository.transition(
                owner_id, round_id, current.row_version,
                frozenset({current.status}), "paused",
            )
            if paused is not None:
                break

    async def _execute(self, owner_id: UUID, round_id: UUID) -> None:
        try:
            await self._run(owner_id, round_id)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not _is_storage_failure(error):
                await self._fail_round(owner_id, round_id)
                return
            logger.warning("STORAGE_UNAVAILABLE resource_id=%s operation=execute", round_id)
            try:
                await self._pause_owned_round(round_id)
            except Exception as pause_error:
                if not _is_storage_failure(pause_error):
                    raise
                # Durable lease expiration makes this recoverable once storage returns.
                logger.warning("STORAGE_UNAVAILABLE resource_id=%s operation=pause", round_id)

    async def _run(self, owner_id: UUID, round_id: UUID) -> None:
        config_row = await self._repository.get_for_owner(owner_id, round_id)
        if config_row is None:
            return
        config_view = await self._research.get_config_version(
            owner_id,
            config_row.config_version_id,
        )
        config = config_view.full_snapshot

        while True:
            rows = await self._repository.get_result_rows_for_owner(
                owner_id,
                round_id,
            )
            if rows is None:
                return
            if rows.round.status == "pausing":
                await self._pause_at_checkpoint(owner_id, rows.round)
                return
            if rows.round.status != "running":
                return
            respondent = next(
                (
                    row
                    for row in rows.respondents
                    if row.status in {"pending", "in_progress"}
                ),
                None,
            )
            if respondent is None:
                target = (
                    "completed_with_errors"
                    if rows.round.failed_respondents
                    else "completed"
                )
                completed = await self._repository.transition(
                    owner_id,
                    round_id,
                    rows.round.row_version,
                    frozenset({"running"}),
                    target,
                )
                if completed is None:
                    current = await self._repository.get_for_owner(
                        owner_id,
                        round_id,
                    )
                    if current is not None and current.status == "pausing":
                        await self._pause_at_checkpoint(owner_id, current)
                return
            try:
                should_continue = await self._execute_respondent(
                    owner_id,
                    rows,
                    respondent,
                    config,
                )
                if not should_continue:
                    return
            except Exception as error:
                if _is_storage_failure(error):
                    raise
                if not await self._fail_respondent(
                    owner_id,
                    round_id,
                    respondent.id,
                    error,
                ):
                    return

    async def _execute_respondent(
        self,
        owner_id: UUID,
        rows,
        respondent: RoundRespondentRow,
        config: SurveyConfig,
    ) -> bool:
        session = _session_for(rows, respondent.id)
        if respondent.status == "pending":
            now = datetime.now(UTC)
            respondent.status = "in_progress"
            respondent.started_at = now
            session.status = "in_progress"
            session.started_at = now
            checkpoint = _checkpoint(
                rows,
                respondent,
                session,
                active_respondent_id=respondent.id,
                lease_owner=self._lease_owner,
                lease_expires_at=self._lease_expiry(),
            )
            if not await self._commit(owner_id, rows.round, checkpoint):
                return False

        while respondent.completed_questions < respondent.total_questions:
            rows = await self._repository.get_result_rows_for_owner(
                owner_id,
                rows.round.id,
            )
            if rows is None or rows.round.status != "running":
                if rows is not None and rows.round.status == "pausing":
                    await self._pause_at_checkpoint(owner_id, rows.round)
                return False
            respondent = _respondent_for(rows, respondent.id)
            session = _session_for(rows, respondent.id)
            dialog = _dialog_for(rows, session.id)
            question = config.questions[respondent.completed_questions]

            await self._engine.wait_before_question()
            question_message = DialogMessage(
                id=f"question-{uuid4()}",
                role="interviewer",
                content=question.question,
                timestamp=datetime.now(UTC),
                questionId=question.id,
            )
            candidate_dialog = [*dialog, question_message]
            if self._engine.respondent_should_terminate(candidate_dialog):
                termination = self._engine.termination_message(rows.round.locale)
                candidate_dialog.append(termination)
                reason = self._engine.termination_reason(
                    rows.round.locale,
                    "respondent",
                )
                _terminate(
                    respondent,
                    session,
                    "terminated_by_respondent",
                    "RESPONDENT_TERMINATED",
                    reason,
                )
                checkpoint = _checkpoint(
                    rows,
                    respondent,
                    session,
                    active_respondent_id=None,
                    lease_owner=self._lease_owner,
                    lease_expires_at=self._lease_expiry(),
                    messages=_message_rows(session.id, candidate_dialog[-2:], len(dialog)),
                )
                return await self._commit(owner_id, rows.round, checkpoint)

            await self._engine.wait_before_answer()
            current = await self._repository.get_for_owner(owner_id, rows.round.id)
            if current is None or current.status not in {"running", "pausing"}:
                return False
            try:
                async with asyncio.timeout(min(config.maxResponseTime, getattr(self._engine, "request_timeout", config.maxResponseTime))):
                    answer = await self._engine.answer(
                        RespondentProfile.model_validate(respondent.profile_json),
                        question, rows.round.locale, rows.round.mode,
                        config=config, history=dialog,
                        research_goal=(rows.round.execution_context or {}).get("researchGoal", ""),
                    )
            except TimeoutError:
                raise ModelCallError("MODEL_TIMEOUT") from None
            validate_answer(question, answer.answerValue)
            if answer.questionId != question.id:
                raise ModelCallError("MODEL_INVALID_ANSWER")
            respondent.completed_questions += 1
            session_dialog = [*candidate_dialog, answer]
            low_quality = self._engine.response_is_low_quality(session_dialog)
            interviewer_terminated = self._engine.interviewer_should_terminate(
                session_dialog,
                low_quality,
            )
            if interviewer_terminated:
                reason = self._engine.termination_reason(
                    rows.round.locale,
                    "interviewer",
                    low_quality,
                )
                _terminate(
                    respondent,
                    session,
                    "terminated_by_interviewer",
                    "INTERVIEWER_TERMINATED",
                    reason,
                )
            response = ResponseRow(
                id=uuid4(),
                round_respondent_id=respondent.id,
                question_id=question.id,
                answer_value_json=answer.answerValue.model_dump(mode="json"),
                status="completed",
                created_at=answer.timestamp,
            )
            checkpoint = _checkpoint(
                rows,
                respondent,
                session,
                active_respondent_id=(
                    None if interviewer_terminated else respondent.id
                ),
                lease_owner=self._lease_owner,
                lease_expires_at=self._lease_expiry(),
                messages=_message_rows(
                    session.id,
                    [question_message, answer],
                    len(dialog),
                ),
                responses=(response,),
            )
            if not await self._commit(owner_id, rows.round, checkpoint):
                return False
            if interviewer_terminated:
                return True

        return await self._complete_respondent(
            owner_id,
            rows.round.id,
            respondent.id,
            config,
        )

    async def _complete_respondent(
        self,
        owner_id: UUID,
        round_id: UUID,
        respondent_id: UUID,
        config: SurveyConfig,
    ) -> bool:
        rows = await self._repository.get_result_rows_for_owner(owner_id, round_id)
        if rows is None:
            return False
        if rows.round.status == "pausing":
            await self._pause_at_checkpoint(owner_id, rows.round)
            return False
        if rows.round.status != "running":
            return False
        respondent = _respondent_for(rows, respondent_id)
        session = _session_for(rows, respondent_id)
        inference_rows: tuple[InferenceResultRow, ...] = ()
        if (
            getattr(self._engine, "supports_inference", True)
            and rows.round.mode == "interview"
            and config.inferenceConfig is not None
            and config.inferenceConfig.enabled
        ):
            inference_rows = await self._infer(
                rows,
                respondent,
                session,
                config.inferenceConfig,
            )
        now = datetime.now(UTC)
        respondent.status = "completed"
        respondent.finished_at = now
        session.status = "completed"
        session.finished_at = now
        checkpoint = _checkpoint(
            rows,
            respondent,
            session,
            active_respondent_id=None,
            lease_owner=self._lease_owner,
            lease_expires_at=self._lease_expiry(),
            inference_results=inference_rows,
        )
        return await self._commit(owner_id, rows.round, checkpoint)

    async def _infer(
        self,
        rows,
        respondent: RoundRespondentRow,
        session: SessionRow,
        config: InferenceConfig,
    ) -> tuple[InferenceResultRow, ...]:
        results = await self._inference.infer_for_session(
            run_id=str(rows.round.id),
            respondent=RespondentProfile.model_validate(respondent.profile_json),
            session=InterviewSession(
                respondentId=respondent.profile_json["id"],
                status=session.status,
                terminationReason=session.termination_reason,
                dialog=_dialog_for(rows, session.id),
                completedQuestions=respondent.completed_questions,
                totalQuestions=respondent.total_questions,
                startTime=session.started_at,
                endTime=session.finished_at,
            ),
            config=config,
            locale=rows.round.locale,
        )
        now = datetime.now(UTC)
        return tuple(
            InferenceResultRow(
                id=uuid4(),
                round_respondent_id=respondent.id,
                task_id=result.taskId,
                task_name=result.taskName,
                kind=result.kind,
                status=result.status,
                value_json=result.value,
                reason=result.reason,
                evidence_json=[
                    evidence.model_dump(mode="json")
                    for evidence in result.evidence
                ],
                error_code=("INFERENCE_FAILED" if result.status == "failed" else None),
                error_message=result.error,
                created_at=now,
                finished_at=now,
            )
            for result in results
        )

    async def _commit(
        self,
        owner_id: UUID,
        round_row: ResearchRoundRow,
        checkpoint: RoundCheckpoint,
    ) -> bool:
        committed = await self._repository.checkpoint(
            owner_id,
            round_row.id,
            round_row.row_version,
            checkpoint,
        )
        if committed is None:
            current = await self._repository.get_for_owner(owner_id, round_row.id)
            if current is None or current.status != "pausing":
                return False
            checkpoint = replace(
                checkpoint,
                status="pausing",
                pause_requested_at=current.pause_requested_at,
                lease_owner=current.lease_owner,
                lease_expires_at=self._lease_expiry(),
            )
            committed = await self._repository.checkpoint(
                owner_id,
                round_row.id,
                current.row_version,
                checkpoint,
            )
            if committed is None:
                return False
        current = await self._repository.get_for_owner(owner_id, round_row.id)
        if current is not None and current.status == "pausing":
            await self._pause_at_checkpoint(owner_id, current)
            return False
        return current is not None and current.status == "running"

    async def _pause_at_checkpoint(
        self,
        owner_id: UUID,
        row: ResearchRoundRow,
    ) -> None:
        await self._repository.transition(
            owner_id,
            row.id,
            row.row_version,
            frozenset({"pausing"}),
            "paused",
        )

    async def _fail_respondent(
        self,
        owner_id: UUID,
        round_id: UUID,
        respondent_id: UUID,
        error: Exception,
    ) -> bool:
        rows = await self._repository.get_result_rows_for_owner(owner_id, round_id)
        if rows is None:
            return False
        if rows.round.status == "pausing":
            await self._pause_at_checkpoint(owner_id, rows.round)
            return False
        if rows.round.status != "running":
            return False
        respondent = _respondent_for(rows, respondent_id)
        session = _session_for(rows, respondent_id)
        now = datetime.now(UTC)
        respondent.status = "failed"
        respondent.error_code = "RESPONDENT_EXECUTION_FAILED"
        respondent.error_message = str(error)
        respondent.finished_at = now
        session.status = "failed"
        session.error_code = "RESPONDENT_EXECUTION_FAILED"
        session.error_message = str(error)
        session.finished_at = now
        checkpoint = _checkpoint(
            rows,
            respondent,
            session,
            active_respondent_id=None,
            lease_owner=self._lease_owner,
            lease_expires_at=self._lease_expiry(),
        )
        return await self._commit(owner_id, rows.round, checkpoint)

    async def _fail_round(self, owner_id: UUID, round_id: UUID) -> None:
        current = await self._repository.get_for_owner(owner_id, round_id)
        if current is None or current.status not in {
            "queued",
            "running",
            "pausing",
        }:
            return
        await self._repository.transition(
            owner_id,
            round_id,
            current.row_version,
            frozenset({current.status}),
            "failed",
        )

    def _lease_expiry(self) -> datetime:
        return datetime.now(UTC) + timedelta(seconds=self._lease_seconds)


def _checkpoint(
    rows,
    respondent: RoundRespondentRow,
    session: SessionRow,
    *,
    active_respondent_id: UUID | None,
    lease_owner: str,
    lease_expires_at: datetime,
    messages=(),
    responses=(),
    inference_results=(),
) -> RoundCheckpoint:
    statuses = {
        row.id: (respondent.status if row.id == respondent.id else row.status)
        for row in rows.respondents
    }
    return RoundCheckpoint(
        status=rows.round.status,
        active_respondent_id=active_respondent_id,
        total_respondents=len(statuses),
        completed_respondents=sum(
            status == "completed" for status in statuses.values()
        ),
        terminated_respondents=sum(
            status
            in {"terminated_by_respondent", "terminated_by_interviewer"}
            for status in statuses.values()
        ),
        failed_respondents=sum(status == "failed" for status in statuses.values()),
        incomplete_respondents=sum(
            status in {"pending", "in_progress", "cancelled"}
            for status in statuses.values()
        ),
        pause_requested_at=rows.round.pause_requested_at,
        lease_owner=lease_owner,
        lease_expires_at=lease_expires_at,
        respondent=respondent,
        session=session,
        messages=tuple(messages),
        responses=tuple(responses),
        inference_results=tuple(inference_results),
        error_code=rows.round.error_code,
        error_message=rows.round.error_message,
    )


def _message_rows(
    session_id: UUID,
    messages: list[DialogMessage],
    first_ordinal: int,
) -> tuple[MessageRow, ...]:
    return tuple(
        MessageRow(
            id=uuid4(),
            session_id=session_id,
            ordinal=first_ordinal + offset,
            role=message.role,
            question_id=message.questionId,
            content=message.content,
            sentiment=message.sentiment,
            answer_value_json=(
                message.answerValue.model_dump(mode="json")
                if message.answerValue is not None
                else None
            ),
            created_at=message.timestamp,
        )
        for offset, message in enumerate(messages)
    )


def _dialog_for(rows, session_id: UUID) -> list[DialogMessage]:
    return [
        DialogMessage(
            id=str(row.id),
            role=row.role,
            content=row.content,
            timestamp=row.created_at,
            questionId=row.question_id,
            sentiment=row.sentiment,
            answerValue=row.answer_value_json,
        )
        for row in rows.messages
        if row.session_id == session_id
    ]


def _respondent_for(rows, respondent_id: UUID) -> RoundRespondentRow:
    return next(row for row in rows.respondents if row.id == respondent_id)


def _session_for(rows, respondent_id: UUID) -> SessionRow:
    return next(
        row for row in rows.sessions if row.round_respondent_id == respondent_id
    )


def _terminate(
    respondent: RoundRespondentRow,
    session: SessionRow,
    status: str,
    code: str,
    reason: str,
) -> None:
    now = datetime.now(UTC)
    respondent.status = status
    respondent.termination_code = code
    respondent.termination_reason = reason
    respondent.finished_at = now
    session.status = status
    session.termination_code = code
    session.termination_reason = reason
    session.finished_at = now


def _uuid(value: UUID | str) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)


def _is_storage_failure(error: Exception) -> bool:
    return isinstance(error, STORAGE_ERRORS) or (
        isinstance(error, ApiError) and error.code == "STORAGE_UNAVAILABLE"
    )
