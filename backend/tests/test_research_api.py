from __future__ import annotations

import httpx
import pytest

from app.main import create_app
from app.services.auth_service import AuthService
from app.services.research_service import ResearchService
from research_support import FakeAuthRepository, FakeResearchRepository, valid_config


@pytest.fixture
async def client():
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    application = create_app(
        auth_service=AuthService(auth_repository),
        research_service=ResearchService(FakeResearchRepository()),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="https://survey.test",
    ) as api_client:
        logged_in = await api_client.post(
            "/api/auth/login",
            json={
                "username": "alice",
                "password": "Research-Password-01!",
            },
        )
        csrf = logged_in.cookies["survey_csrf"]
        api_client.headers.update(
            {"Origin": "https://survey.test", "X-CSRF-Token": csrf}
        )
        yield api_client


@pytest.mark.asyncio
async def test_project_and_questionnaire_crud_contract(
    client: httpx.AsyncClient,
) -> None:
    created_project = await client.post(
        "/api/projects",
        json={"name": "A", "researchGoal": "G", "principalName": "Alice"},
    )
    assert created_project.status_code == 201
    project = created_project.json()
    assert project["researchGoal"] == "G"

    listed_projects = await client.get("/api/projects")
    assert [item["id"] for item in listed_projects.json()] == [project["id"]]

    created_questionnaire = await client.post(
        f"/api/projects/{project['id']}/questionnaires",
        json={"mode": "survey", "config": valid_config()},
    )
    assert created_questionnaire.status_code == 201
    questionnaire = created_questionnaire.json()
    assert questionnaire["draftRevision"] == 1
    assert questionnaire["config"]["title"] == "Original survey"

    updated = await client.patch(
        f"/api/questionnaires/{questionnaire['id']}",
        json={"config": valid_config(title="Updated"), "expectedRevision": 1},
    )
    assert updated.status_code == 200
    assert updated.json()["draftRevision"] == 2
    assert updated.json()["title"] == "Updated"

    stale = await client.patch(
        f"/api/questionnaires/{questionnaire['id']}",
        json={"config": valid_config(title="Stale"), "expectedRevision": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "DRAFT_CONFLICT"


@pytest.mark.asyncio
async def test_business_routes_require_authentication_and_csrf() -> None:
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    application = create_app(
        auth_service=AuthService(auth_repository),
        research_service=ResearchService(FakeResearchRepository()),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="https://survey.test",
    ) as anonymous:
        unauthenticated = await anonymous.get("/api/projects")
        assert unauthenticated.status_code == 401
        assert unauthenticated.json()["code"] == "AUTH_SESSION_EXPIRED"

        logged_in = await anonymous.post(
            "/api/auth/login",
            json={
                "username": "alice",
                "password": "Research-Password-01!",
            },
        )
        missing_csrf = await anonymous.post(
            "/api/projects",
            headers={"Origin": "https://survey.test"},
            json={
                "name": "A",
                "researchGoal": "G",
                "principalName": "Alice",
            },
        )
        assert logged_in.status_code == 200
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["code"] == "AUTH_CSRF_INVALID"
