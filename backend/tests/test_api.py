import random

import httpx
import pytest

from app.main import create_app
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.mock_engine import MockEngine, default_survey_config
from app.services.run_service import RunService


@pytest.fixture
def repository() -> MemoryRepository:
    return MemoryRepository()


@pytest.fixture
def run_service(repository: MemoryRepository) -> RunService:
    return RunService(
        repository=repository,
        engine=MockEngine(random.Random(3), delay_scale=0),
        analytics=AnalyticsService(),
    )


@pytest.fixture
async def client(
    repository: MemoryRepository,
    run_service: RunService,
):
    app = create_app(repository=repository, run_service=run_service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as api_client:
        yield api_client


async def create_completed_run(
    client: httpx.AsyncClient,
    run_service: RunService,
) -> str:
    created = await client.post(
        "/api/runs",
        json={
            "mode": "survey",
            "config": default_survey_config().model_dump(mode="json"),
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]
    await run_service.wait(run_id)
    return run_id


@pytest.mark.asyncio
async def test_default_template(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/templates/default")

    assert response.status_code == 200
    assert response.json()["title"] == "用户体验调研"


@pytest.mark.asyncio
async def test_create_read_and_missing_run(
    client: httpx.AsyncClient,
) -> None:
    created = await client.post(
        "/api/runs",
        json={
            "mode": "survey",
            "config": default_survey_config().model_dump(mode="json"),
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    fetched = await client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == run_id

    missing = await client.get("/api/runs/missing")
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "RUN_NOT_FOUND"


@pytest.mark.asyncio
async def test_history_analytics_and_export(
    client: httpx.AsyncClient,
    run_service: RunService,
) -> None:
    run_id = await create_completed_run(client, run_service)

    saved = await client.post("/api/history", json={"runId": run_id})
    assert saved.status_code == 201
    history_id = saved.json()["id"]

    records = await client.get("/api/history")
    assert records.json()[0]["id"] == history_id

    analytics = await client.post(
        f"/api/runs/{run_id}/analytics/query",
        json={"questionId": "q1", "filters": {}, "groupBy": ["city"]},
    )
    assert analytics.status_code == 200
    assert analytics.json()["groupedQuestionSummaries"]

    exported = await client.get(
        f"/api/runs/{run_id}/exports",
        params={"format": "csv"},
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert exported.content.decode("utf-8-sig").startswith(
        "respondentId,name,city,status"
    )
