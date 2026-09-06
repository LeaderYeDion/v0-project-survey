from __future__ import annotations

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
async def round_api():
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    await auth_repository.add_user("bob")
    research_repository = FakeResearchRepository()
    research = ResearchService(research_repository)
    round_repository = MemoryRepository()
    catalog = MockCatalog()
    run_service = RunService(
        repository=round_repository,
        research=research,
        engine=MockEngine(catalog, random.Random(5), delay_scale=0),
        analytics=AnalyticsService(catalog),
    )
    application = create_app(
        repository=round_repository,
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
            logged_in = await client.post(
                "/api/auth/login",
                json={
                    "username": username,
                    "password": "Research-Password-01!",
                },
            )
            client.headers.update(
                {
                    "Origin": "https://survey.test",
                    "X-CSRF-Token": logged_in.cookies["survey_csrf"],
                }
            )
        yield alice, bob, run_service


async def create_questionnaire(client: httpx.AsyncClient) -> tuple[str, str]:
    project = (
        await client.post(
            "/api/projects",
            json={"name": "A", "researchGoal": "G", "principalName": "A"},
        )
    ).json()
    questionnaire = (
        await client.post(
            f"/api/projects/{project['id']}/questionnaires",
            json={"mode": "survey", "config": valid_config()},
        )
    ).json()
    return project["id"], questionnaire["id"]


@pytest.mark.asyncio
async def test_owned_round_create_list_get_and_illegal_transition(round_api) -> None:
    alice, bob, run_service = round_api
    project_id, questionnaire_id = await create_questionnaire(alice)

    response = await alice.post(
        f"/api/questionnaires/{questionnaire_id}/rounds"
    )
    assert response.status_code == 201
    round_id = response.json()["id"]
    await run_service.wait(round_id)

    listed = await alice.get(f"/api/projects/{project_id}/rounds")
    fetched = await alice.get(f"/api/rounds/{round_id}")
    forbidden = await bob.get(f"/api/rounds/{round_id}")
    illegal = await alice.post(f"/api/rounds/{round_id}/pause")

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [round_id]
    assert fetched.status_code == 200
    assert fetched.json()["status"] == "completed"
    assert forbidden.status_code == 404
    assert forbidden.json()["code"] == "RESOURCE_NOT_FOUND"
    assert illegal.status_code == 409
    assert illegal.json()["code"] == "INVALID_RUN_TRANSITION"
    assert illegal.json()["details"] == {
        "currentStatus": "completed",
        "allowedActions": [],
    }


@pytest.mark.asyncio
async def test_round_mutations_require_csrf(round_api) -> None:
    alice, _bob, _run_service = round_api
    _project_id, questionnaire_id = await create_questionnaire(alice)

    response = await alice.post(
        f"/api/questionnaires/{questionnaire_id}/rounds",
        headers={"Origin": "https://survey.test", "X-CSRF-Token": "wrong"},
    )

    assert response.status_code == 403
    assert response.json()["code"] == "AUTH_CSRF_INVALID"
