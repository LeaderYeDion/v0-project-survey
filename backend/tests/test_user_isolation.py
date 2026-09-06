from __future__ import annotations

import httpx
import pytest

from app.main import create_app
from app.services.auth_service import AuthService
from app.services.research_service import ResearchService
from research_support import FakeAuthRepository, FakeResearchRepository, valid_config


@pytest.fixture
async def clients():
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    await auth_repository.add_user("bob")
    application = create_app(
        auth_service=AuthService(auth_repository),
        research_service=ResearchService(FakeResearchRepository()),
    )
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application),
            base_url="https://survey.test",
        ) as alice,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application),
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
        yield alice, bob


@pytest.mark.asyncio
async def test_other_user_cannot_list_or_open_owned_questionnaire(
    clients,
) -> None:
    alice, bob = clients
    project_response = await alice.post(
        "/api/projects",
        json={"name": "A", "researchGoal": "G", "principalName": "Alice"},
    )
    assert project_response.status_code == 201
    project = project_response.json()
    questionnaire_response = await alice.post(
        f"/api/projects/{project['id']}/questionnaires",
        json={"mode": "survey", "config": valid_config()},
    )
    assert questionnaire_response.status_code == 201
    questionnaire = questionnaire_response.json()

    opened = await bob.get(f"/api/questionnaires/{questionnaire['id']}")
    listed = await bob.get(f"/api/projects/{project['id']}/questionnaires")

    assert opened.status_code == 404
    assert opened.json()["code"] == "RESOURCE_NOT_FOUND"
    assert listed.status_code == 404
    assert listed.json()["code"] == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_project_lists_never_include_another_users_rows(clients) -> None:
    alice, bob = clients
    alice_project = await alice.post(
        "/api/projects",
        json={"name": "Alice", "researchGoal": "A", "principalName": "A"},
    )
    bob_project = await bob.post(
        "/api/projects",
        json={"name": "Bob", "researchGoal": "B", "principalName": "B"},
    )

    assert alice_project.status_code == 201
    assert bob_project.status_code == 201
    assert [row["name"] for row in (await alice.get("/api/projects")).json()] == [
        "Alice"
    ]
    assert [row["name"] for row in (await bob.get("/api/projects")).json()] == [
        "Bob"
    ]
