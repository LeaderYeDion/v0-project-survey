import random

import pytest

from app.repositories.memory import MemoryRepository
from app.schemas.survey import CreateRunRequest
from app.services.analytics_service import AnalyticsService
from app.services.mock_engine import MockEngine, default_survey_config
from app.services.run_service import RunService


@pytest.mark.asyncio
async def test_run_progresses_to_completed() -> None:
    repository = MemoryRepository()
    service = RunService(
        repository=repository,
        engine=MockEngine(random.Random(1), delay_scale=0),
        analytics=AnalyticsService(),
    )

    created = await service.create_run(
        CreateRunRequest(mode="survey", config=default_survey_config())
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.progress.totalRespondents == 7
    assert (
        completed.progress.completedRespondents
        + completed.progress.terminatedRespondents
        == 7
    )
    assert completed.activeRespondentId is None
    assert completed.questionAnalysis
    assert completed.responses


@pytest.mark.asyncio
async def test_cancel_stops_run() -> None:
    repository = MemoryRepository()
    service = RunService(
        repository=repository,
        engine=MockEngine(random.Random(1), delay_scale=0.1),
        analytics=AnalyticsService(),
    )
    created = await service.create_run(
        CreateRunRequest(mode="interview", config=default_survey_config())
    )

    cancelled = await service.cancel(created.id)

    assert cancelled is not None
    assert cancelled.status == "cancelled"
    assert cancelled.activeRespondentId is None
