import random

import httpx
import pytest

from app.main import create_app
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.run_service import RunService

LANGUAGE_HEADERS = {"Accept-Language": "en-US"}
CATALOG = MockCatalog()


@pytest.fixture
def repository() -> MemoryRepository:
    return MemoryRepository()


@pytest.fixture
def run_service(repository: MemoryRepository) -> RunService:
    return RunService(
        repository=repository,
        engine=MockEngine(CATALOG, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(CATALOG),
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
        headers=LANGUAGE_HEADERS,
        json={
            "mode": "survey",
            "config": CATALOG.default_template("en-US").model_dump(mode="json"),
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]
    await run_service.wait(run_id)
    return run_id


@pytest.mark.asyncio
async def test_default_template(client: httpx.AsyncClient) -> None:
    missing = await client.get("/api/templates/default")
    assert missing.status_code == 200
    assert missing.headers["content-language"] == "en-US"
    assert missing.json()["title"] == "User Experience Survey"

    response = await client.get(
        "/api/templates/default",
        headers=LANGUAGE_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-language"] == "en-US"
    assert response.json()["title"] == "User Experience Survey"

    unsupported = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "fr-FR"},
    )
    assert unsupported.status_code == 200
    assert unsupported.headers["content-language"] == "en-US"
    assert unsupported.json()["title"] == "User Experience Survey"

    chinese = await client.get(
        "/api/templates/default",
        headers={"Accept-Language": "zh-CN"},
    )
    assert chinese.status_code == 200
    assert chinese.headers["content-language"] == "zh-CN"
    assert chinese.json()["title"] == "用户体验调研"


@pytest.mark.asyncio
async def test_create_read_and_missing_run(
    client: httpx.AsyncClient,
) -> None:
    created = await client.post(
        "/api/runs",
        headers=LANGUAGE_HEADERS,
        json={
            "mode": "survey",
            "config": CATALOG.default_template("en-US").model_dump(mode="json"),
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    fetched = await client.get(
        f"/api/runs/{run_id}",
        headers=LANGUAGE_HEADERS,
    )
    assert fetched.status_code == 200
    assert fetched.headers["content-language"] == "en-US"
    assert fetched.json()["id"] == run_id

    missing = await client.get(
        "/api/runs/missing",
        headers=LANGUAGE_HEADERS,
    )
    assert missing.status_code == 404
    assert missing.headers["content-language"] == "en-US"
    assert missing.json()["detail"]["code"] == "RUN_NOT_FOUND"

    invalid = await client.post(
        "/api/runs",
        headers=LANGUAGE_HEADERS,
        json={},
    )
    assert invalid.status_code == 422
    assert invalid.headers["content-language"] == "en-US"


@pytest.mark.asyncio
async def test_history_analytics_and_export(
    client: httpx.AsyncClient,
    run_service: RunService,
) -> None:
    run_id = await create_completed_run(client, run_service)

    completed = await client.get(
        f"/api/runs/{run_id}",
        headers={"Accept-Language": "zh-CN"},
    )
    completed_payload = completed.json()
    assert completed_payload["locale"] == "en-US"
    assert completed_payload["respondents"][0]["gender"] in {"Male", "Female"}
    assert completed_payload["config"]["title"] == "User Experience Survey"

    saved = await client.post(
        "/api/history",
        headers=LANGUAGE_HEADERS,
        json={"runId": run_id},
    )
    assert saved.status_code == 201
    assert saved.json()["locale"] == "en-US"
    history_id = saved.json()["id"]

    records = await client.get("/api/history", headers=LANGUAGE_HEADERS)
    assert records.json()[0]["id"] == history_id

    analytics = await client.post(
        f"/api/runs/{run_id}/analytics/query",
        headers=LANGUAGE_HEADERS,
        json={"questionId": "q1", "filters": {}, "groupBy": ["city"]},
    )
    assert analytics.status_code == 200
    assert analytics.json()["groupedQuestionSummaries"]
    assert analytics.json()["dimensionMetadata"][0]["label"] == "Gender"
    assert analytics.json()["groupedQuestionSummaries"][0]["label"].startswith(
        "Work city:"
    )

    exported = await client.get(
        f"/api/runs/{run_id}/exports",
        headers=LANGUAGE_HEADERS,
        params={"format": "csv"},
    )
    assert exported.status_code == 200
    assert exported.headers["content-language"] == "en-US"
    assert exported.headers["content-type"].startswith("text/csv")
    assert exported.content.decode("utf-8-sig").startswith(
        "respondentId,name,city,status"
    )

    exported_json = await client.get(
        f"/api/runs/{run_id}/exports",
        headers={"Accept-Language": "zh-CN"},
        params={"format": "json"},
    )
    assert exported_json.json()["respondents"][0]["gender"] in {
        "Male",
        "Female",
    }
