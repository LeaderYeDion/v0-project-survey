import random

import pytest

from app.repositories.memory import MemoryRepository
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import CreateRunRequest
from app.services.analytics_service import AnalyticsService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
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


@pytest.mark.asyncio
async def test_disabled_inference_produces_no_results() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.inferenceConfig = None

    created = await service.create_run(
        CreateRunRequest(mode="interview", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.inferenceResults == []
    assert completed.inferenceSummary == []


@pytest.mark.asyncio
async def test_enabled_interview_inference_generates_results() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.respondentConfigs[0].count = 1
    config.inferenceConfig = {
        "enabled": True,
        "profileEnabled": True,
        "attitudeEnabled": True,
        "profileTasks": [
            {
                "id": "profile-income",
                "name": "家庭年收入",
                "options": ["5万以下", "5万-20万", "20万-50万"],
                "multiple": False,
                "enabled": True,
            }
        ],
        "attitudeTasks": [
            {
                "id": "attitude-common-prosperity",
                "name": "共同富裕倾向",
                "options": ["积极", "中立", "消极"],
                "enabled": True,
            }
        ],
    }

    created = await service.create_run(
        CreateRunRequest(mode="interview", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert len(completed.inferenceResults) == len(completed.respondents) * 2
    assert {item.kind for item in completed.inferenceResults} == {
        "profile",
        "attitude",
    }
    assert all(item.status == "completed" for item in completed.inferenceResults)
    assert len(completed.inferenceSummary) == 2


@pytest.mark.asyncio
async def test_survey_mode_ignores_inference_config() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.respondentConfigs[0].count = 1
    config.inferenceConfig = {
        "enabled": True,
        "profileEnabled": True,
        "attitudeEnabled": False,
        "profileTasks": [
            {
                "id": "profile-income",
                "name": "家庭年收入",
                "options": ["5万以下", "5万-20万"],
                "multiple": False,
                "enabled": True,
            }
        ],
        "attitudeTasks": [],
    }

    created = await service.create_run(
        CreateRunRequest(mode="survey", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.inferenceResults == []
    assert completed.inferenceSummary == []
