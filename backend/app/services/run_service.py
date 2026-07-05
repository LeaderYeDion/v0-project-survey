import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from app.repositories.memory import MemoryRepository
from app.locales import Locale
from app.schemas.survey import (
    CreateRunRequest,
    DialogMessage,
    InterviewSession,
    RunSnapshot,
    SurveyProgress,
)
from app.services.analytics_service import AnalyticsService
from app.services.simulation_engine import SimulationEngine


class RunService:
    def __init__(
        self,
        repository: MemoryRepository,
        engine: SimulationEngine,
        analytics: AnalyticsService,
    ) -> None:
        self.repository = repository
        self.engine = engine
        self.analytics = analytics
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def create_run(
        self,
        request: CreateRunRequest,
        locale: Locale,
    ) -> RunSnapshot:
        snapshot = RunSnapshot.empty(
            run_id=f"run-{uuid4()}",
            mode=request.mode,
            locale=locale,
            config=request.config.model_copy(deep=True),
            created_at=datetime.now(UTC),
        )
        await self.repository.put_run(snapshot)
        self._tasks[snapshot.id] = asyncio.create_task(
            self._execute(snapshot.id)
        )
        return snapshot

    async def get(self, run_id: str) -> RunSnapshot | None:
        return await self.repository.get_run(run_id)

    async def cancel(self, run_id: str) -> RunSnapshot | None:
        snapshot = await self.get(run_id)
        if snapshot is None:
            return None
        if snapshot.status in {"completed", "failed", "cancelled"}:
            return snapshot
        task = self._tasks.get(run_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        snapshot = await self.get(run_id) or snapshot
        snapshot.status = "cancelled"
        snapshot.activeRespondentId = None
        snapshot.progress.inProgressRespondents = 0
        snapshot.finishedAt = datetime.now(UTC)
        await self.repository.put_run(snapshot)
        return snapshot

    async def wait(self, run_id: str) -> RunSnapshot:
        task = self._tasks.get(run_id)
        if task:
            try:
                await task
            except asyncio.CancelledError:
                pass
        snapshot = await self.get(run_id)
        if snapshot is None:
            raise KeyError(run_id)
        return snapshot

    def _refresh_analytics(self, snapshot: RunSnapshot) -> None:
        snapshot.sentiment = self.analytics.analyze_sentiment(snapshot.sessions)
        snapshot.questionAnalysis = self.analytics.analyze_questions(
            snapshot.sessions,
            snapshot.config.questions,
        )
        snapshot.demographicAnalysis = self.analytics.analyze_demographics(
            snapshot.sessions,
            snapshot.respondents,
            snapshot.config.questions,
            snapshot.locale,
        )
        snapshot.responses = self.analytics.build_responses(
            snapshot.sessions,
            snapshot.id,
            snapshot.config.questions,
        )

    async def _execute(self, run_id: str) -> None:
        try:
            snapshot = await self.get(run_id)
            if snapshot is None:
                return
            snapshot.status = "running"
            snapshot.startedAt = datetime.now(UTC)
            snapshot.respondents = self.engine.generate_respondents(
                snapshot.config.respondentConfigs,
                snapshot.locale,
            )
            snapshot.sessions = [
                InterviewSession(
                    respondentId=respondent.id,
                    status="pending",
                    completedQuestions=0,
                    totalQuestions=len(snapshot.config.questions),
                )
                for respondent in snapshot.respondents
            ]
            snapshot.progress = SurveyProgress(
                totalRespondents=len(snapshot.respondents),
                completedRespondents=0,
                inProgressRespondents=0,
                terminatedRespondents=0,
                currentRespondentIndex=0,
            )
            self._refresh_analytics(snapshot)
            await self.repository.put_run(snapshot)

            for respondent_index, respondent in enumerate(snapshot.respondents):
                snapshot.activeRespondentId = respondent.id
                snapshot.progress.currentRespondentIndex = respondent_index
                snapshot.progress.inProgressRespondents = 1
                session = snapshot.sessions[respondent_index]
                session.status = "in_progress"
                session.startTime = datetime.now(UTC)
                await self.repository.put_run(snapshot)

                terminated = False
                termination_reason: str | None = None
                for question in snapshot.config.questions:
                    question_message = DialogMessage(
                        id=f"question-{uuid4()}",
                        role="interviewer",
                        content=question.question,
                        timestamp=datetime.now(UTC),
                        questionId=question.id,
                    )
                    session.dialog.append(question_message)
                    await self.repository.put_run(snapshot)
                    await self.engine.wait_before_question()

                    if self.engine.respondent_should_terminate(session.dialog):
                        session.dialog.append(
                            self.engine.termination_message(snapshot.locale)
                        )
                        terminated = True
                        termination_reason = self.engine.termination_reason(
                            snapshot.locale,
                            "respondent",
                        )
                        self._refresh_analytics(snapshot)
                        await self.repository.put_run(snapshot)
                        break

                    await self.engine.wait_before_answer()
                    response = self.engine.generate_answer(
                        respondent,
                        question,
                        snapshot.locale,
                    )
                    session.dialog.append(response)
                    session.completedQuestions += 1
                    self._refresh_analytics(snapshot)
                    await self.repository.put_run(snapshot)

                    low_quality = self.engine.response_is_low_quality(
                        session.dialog
                    )
                    if self.engine.interviewer_should_terminate(
                        session.dialog,
                        low_quality,
                    ):
                        terminated = True
                        termination_reason = self.engine.termination_reason(
                            snapshot.locale,
                            "interviewer",
                            low_quality,
                        )
                        break

                session.status = (
                    "terminated_by_respondent"
                    if termination_reason
                    == self.engine.termination_reason(
                        snapshot.locale,
                        "respondent",
                    )
                    else "terminated_by_interviewer"
                    if terminated
                    else "completed"
                )
                session.terminationReason = termination_reason
                session.endTime = datetime.now(UTC)
                snapshot.progress.inProgressRespondents = 0
                if terminated:
                    snapshot.progress.terminatedRespondents += 1
                else:
                    snapshot.progress.completedRespondents += 1
                self._refresh_analytics(snapshot)
                await self.repository.put_run(snapshot)

            snapshot.status = "completed"
            snapshot.activeRespondentId = None
            snapshot.finishedAt = datetime.now(UTC)
            await self.repository.put_run(snapshot)
        except asyncio.CancelledError:
            snapshot = await self.get(run_id)
            if snapshot is not None:
                snapshot.status = "cancelled"
                snapshot.activeRespondentId = None
                snapshot.progress.inProgressRespondents = 0
                snapshot.finishedAt = datetime.now(UTC)
                await self.repository.put_run(snapshot)
            raise
        except Exception as error:
            snapshot = await self.get(run_id)
            if snapshot is not None:
                snapshot.status = "failed"
                snapshot.activeRespondentId = None
                snapshot.progress.inProgressRespondents = 0
                snapshot.finishedAt = datetime.now(UTC)
                snapshot.error = str(error)
                await self.repository.put_run(snapshot)
