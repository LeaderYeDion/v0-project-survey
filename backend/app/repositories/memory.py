import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.survey import RunSnapshot, SurveyHistoryRecord


class MemoryRepository:
    def __init__(self) -> None:
        self._runs: dict[str, RunSnapshot] = {}
        self._history: list[SurveyHistoryRecord] = []
        self._lock = asyncio.Lock()

    async def put_run(self, snapshot: RunSnapshot) -> None:
        async with self._lock:
            self._runs[snapshot.id] = snapshot.model_copy(deep=True)

    async def get_run(self, run_id: str) -> RunSnapshot | None:
        async with self._lock:
            value = self._runs.get(run_id)
            return value.model_copy(deep=True) if value else None

    async def save_history(
        self,
        run: RunSnapshot,
    ) -> SurveyHistoryRecord:
        record = SurveyHistoryRecord(
            id=f"history-{uuid4()}",
            runId=run.id,
            mode=run.mode,
            savedAt=datetime.now(UTC),
            config=run.config,
            sessions=run.sessions,
            respondents=run.respondents,
            progress=run.progress,
            sentiment=run.sentiment,
            questionAnalysis=run.questionAnalysis,
            demographicAnalysis=run.demographicAnalysis,
            responses=run.responses,
        )
        async with self._lock:
            self._history.insert(0, record.model_copy(deep=True))
        return record

    async def list_history(self) -> list[SurveyHistoryRecord]:
        async with self._lock:
            return [item.model_copy(deep=True) for item in self._history]

    async def get_history(
        self,
        history_id: str,
    ) -> SurveyHistoryRecord | None:
        async with self._lock:
            value = next(
                (item for item in self._history if item.id == history_id),
                None,
            )
            return value.model_copy(deep=True) if value else None
