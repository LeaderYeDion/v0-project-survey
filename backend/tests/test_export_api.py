from __future__ import annotations

import json
import random

import httpx
import pytest

from app.main import create_app
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.services.analytics_service import AnalyticsService
from app.services.auth_service import AuthService
from app.services.research_service import ResearchService
from app.services.run_service import RunService
from research_support import FakeAuthRepository, FakeResearchRepository, valid_config


@pytest.fixture
async def export_api():
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    await auth_repository.add_user("bob")
    research = ResearchService(FakeResearchRepository())
    repository = MemoryRepository()
    catalog = MockCatalog()
    run_service = RunService(
        repository=repository,
        research=research,
        engine=MockEngine(catalog, random.Random(5), delay_scale=0),
        analytics=AnalyticsService(catalog),
    )
    application = create_app(
        repository=repository,
        run_service=run_service,
        auth_service=AuthService(auth_repository),
        research_service=research,
    )
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=application,
                raise_app_exceptions=False,
            ),
            base_url="https://survey.test",
        ) as alice,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=application,
                raise_app_exceptions=False,
            ),
            base_url="https://survey.test",
        ) as bob,
    ):
        for client, username in ((alice, "alice"), (bob, "bob")):
            await client.post(
                "/api/auth/login",
                json={
                    "username": username,
                    "password": "Research-Password-01!",
                },
            )
            client.headers.update(
                {"Origin": "https://survey.test", "Accept-Language": "en-US"}
            )

        project = (
            await alice.post(
                "/api/projects",
                headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
                json={"name": "A", "researchGoal": "G", "principalName": "A"},
            )
        ).json()
        questionnaire = (
            await alice.post(
                f"/api/projects/{project['id']}/questionnaires",
                headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
                json={"mode": "survey", "config": valid_config()},
            )
        ).json()
        created = await alice.post(
            f"/api/questionnaires/{questionnaire['id']}/rounds",
            headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        )
        round_id = created.json()["id"]
        await run_service.wait(round_id)
        yield application, alice, bob, round_id


@pytest.mark.asyncio
async def test_filtered_export_records_final_safe_name(export_api) -> None:
    _application, alice, _bob, round_id = export_api

    response = await alice.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        json={
            "format": "csv",
            "scope": "filtered",
            "filename": "../city report",
            "filters": {"city": "Hangzhou"},
        },
    )

    assert response.status_code == 200
    assert 'filename="city report.csv"' in response.headers["content-disposition"]
    assert response.headers["content-language"] == "zh-CN"
    assert response.text.count(",Hangzhou,") == 2
    record_id = response.headers["x-export-record-id"]
    records = (await alice.get(f"/api/rounds/{round_id}/exports")).json()
    record = next(item for item in records if item["id"] == record_id)
    assert record["status"] == "succeeded"
    assert record["filename"] == "city report.csv"
    assert record["filters"] == {"city": "Hangzhou"}


@pytest.mark.asyncio
async def test_full_json_export_returns_every_respondent(export_api) -> None:
    _application, alice, _bob, round_id = export_api

    response = await alice.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        json={"format": "json", "scope": "full", "filename": "all.json"},
    )

    assert response.status_code == 200
    payload = json.loads(response.content)
    assert len(payload["respondents"]) == 2
    assert len(payload["sessions"]) == 2
    assert response.headers["content-type"] == "application/json"


@pytest.mark.asyncio
async def test_unicode_filename_has_constructible_header_before_success(
    export_api,
) -> None:
    _application, alice, _bob, round_id = export_api

    response = await alice.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        json={"format": "json", "scope": "full", "filename": "报告.csv"},
    )
    records = (await alice.get(f"/api/rounds/{round_id}/exports")).json()
    record = records[0]

    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert (
        f'filename="research-round-{round_id[:8]}.json"'
        in disposition
    )
    assert "filename*=UTF-8''%E6%8A%A5%E5%91%8A.json" in disposition
    assert record["filename"] == "报告.json"
    assert record["status"] == "succeeded"


@pytest.mark.asyncio
async def test_empty_export_scope_returns_stable_error(export_api) -> None:
    _application, alice, _bob, round_id = export_api

    response = await alice.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        json={
            "format": "json",
            "scope": "exceptions",
            "filename": "exceptions",
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "EXPORT_SCOPE_EMPTY"
    records = (await alice.get(f"/api/rounds/{round_id}/exports")).json()
    assert records[0]["status"] == "failed"
    assert records[0]["errorCode"] == "EXPORT_SCOPE_EMPTY"


@pytest.mark.asyncio
async def test_generation_failure_returns_stable_error_and_failed_record(
    export_api,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application, alice, _bob, round_id = export_api

    def fail_render(*_args, **_kwargs):
        raise RuntimeError("renderer exploded")

    monkeypatch.setattr(application.state.export_service, "_render", fail_render)
    response = await alice.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": alice.cookies["survey_csrf"]},
        json={"format": "json", "scope": "full"},
    )

    assert response.status_code == 500
    assert response.json()["code"] == "EXPORT_GENERATION_FAILED"
    records = (await alice.get(f"/api/rounds/{round_id}/exports")).json()
    assert records[0]["status"] == "failed"
    assert records[0]["errorCode"] == "EXPORT_GENERATION_FAILED"


@pytest.mark.asyncio
async def test_exports_hide_cross_owner_rounds(export_api) -> None:
    _application, _alice, bob, round_id = export_api

    listed = await bob.get(f"/api/rounds/{round_id}/exports")
    generated = await bob.post(
        f"/api/rounds/{round_id}/exports",
        headers={"X-CSRF-Token": bob.cookies["survey_csrf"]},
        json={"format": "json", "scope": "full"},
    )

    for response in (listed, generated):
        assert response.status_code == 404
        assert response.json()["code"] == "RESOURCE_NOT_FOUND"
