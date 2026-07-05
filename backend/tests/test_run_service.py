import random

import pytest

from app.repositories.memory import MemoryRepository
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import CreateRunRequest
from app.services.analytics_service import AnalyticsService
from app.services.run_service import RunService

CATALOG = MockCatalog()


@pytest.mark.asyncio
async def test_run_progresses_to_completed() -> None:
    repository = MemoryRepository()
    service = RunService(
        repository=repository,
        engine=MockEngine(CATALOG, random.Random(1), delay_scale=0),
        analytics=AnalyticsService(CATALOG),
    )

    created = await service.create_run(
        CreateRunRequest(mode="survey", config=CATALOG.default_template("zh-CN")),
        "zh-CN",
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
        engine=MockEngine(CATALOG, random.Random(1), delay_scale=0.1),
        analytics=AnalyticsService(CATALOG),
    )
    created = await service.create_run(
        CreateRunRequest(mode="interview", config=CATALOG.default_template("zh-CN")),
        "zh-CN",
    )

    cancelled = await service.cancel(created.id)

    assert cancelled is not None
    assert cancelled.status == "cancelled"
    assert cancelled.activeRespondentId is None
