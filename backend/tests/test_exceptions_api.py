from __future__ import annotations

import random
from datetime import UTC, datetime

import httpx
import pytest

from app.main import create_app
from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.schemas.survey import (
    InterviewSession,
    RespondentProfile,
    RunSnapshot,
    SurveyConfig,
)
from app.services.analytics_service import AnalyticsService
from app.services.auth_service import AuthService
from app.services.exception_service import ExceptionService
from app.services.research_service import ResearchService
from app.services.run_service import RunService
from research_support import FakeAuthRepository, FakeResearchRepository, valid_config


class TerminatingEngine(MockEngine):
    def response_is_low_quality(self, previous_dialog) -> bool:
        return True

    def interviewer_should_terminate(self, dialog, low_quality: bool) -> bool:
        return True


def test_exception_groups_sort_by_count_code_and_original_ordinal() -> None:
    now = datetime.now(UTC)
    config = SurveyConfig.model_validate(valid_config())
    profiles = [
        RespondentProfile(
            id=f"r{ordinal}",
            name=f"Person {ordinal}",
            nickname=f"P{ordinal}",
            avatar=str(ordinal),
            age=20 + ordinal,
            gender="all",
            occupation="all",
            city="Hangzhou",
            income="all",
            education="college",
            maritalStatus="single",
            tags=[],
            configId="group-1",
        )
        for ordinal in range(5)
    ]
    details = [
        ("failed", None, "Z_ERROR"),
        ("terminated_by_respondent", "A_TERMINATION", None),
        ("terminated_by_interviewer", "B_TERMINATION", None),
        ("terminated_by_respondent", "A_TERMINATION", None),
        ("failed", None, "RESPONDENT_EXECUTION_FAILED"),
    ]
    sessions = [
        InterviewSession(
            respondentId=profiles[index].id,
            status=status,
            terminationCode=termination_code,
            terminationReason=("Stopped" if termination_code else None),
            errorCode=error_code,
            errorMessage=("Failed" if error_code else None),
            completedQuestions=0,
            totalQuestions=1,
            startTime=now,
            endTime=now,
        )
        for index, (status, termination_code, error_code) in reversed(
            list(enumerate(details))
        )
    ]
    snapshot = RunSnapshot.empty(
        run_id="round-sort",
        mode="survey",
        locale="en-US",
        config=config,
        created_at=now,
    ).model_copy(update={"respondents": profiles, "sessions": sessions})

    report = ExceptionService().report(snapshot)

    assert [group.code for group in report.groups] == [
        "A_TERMINATION",
        "B_TERMINATION",
        "RESPONDENT_EXECUTION_FAILED",
        "Z_ERROR",
    ]
    assert [
        item.respondentId for item in report.groups[0].respondents
    ] == ["r1", "r3"]
    assert report.groups[2].reason == "Respondent execution failed"


@pytest.fixture
async def exceptions_api():
    auth_repository = FakeAuthRepository()
    await auth_repository.add_user("alice")
    await auth_repository.add_user("bob")
    research = ResearchService(FakeResearchRepository())
    repository = MemoryRepository()
    catalog = MockCatalog()
    run_service = RunService(
        repository=repository,
        research=research,
        engine=TerminatingEngine(catalog, random.Random(5), delay_scale=0),
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
            logged_in = await client.post(
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
                headers={
                    "X-CSRF-Token": alice.cookies["survey_csrf"],
                },
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
        yield alice, bob, round_id


@pytest.mark.asyncio
async def test_exception_report_links_reason_to_respondents(exceptions_api) -> None:
    alice, _bob, round_id = exceptions_api

    response = await alice.get(f"/api/rounds/{round_id}/exceptions")

    assert response.status_code == 200
    report = response.json()
    assert report["totalCount"] == 2
    assert [(group["code"], group["count"]) for group in report["groups"]] == [
        ("INTERVIEWER_TERMINATED", 2)
    ]
    respondent = report["groups"][0]["respondents"][0]
    assert respondent.keys() >= {
        "respondentId",
        "profile",
        "completedQuestions",
        "totalQuestions",
        "lastValidAnswer",
        "lastValidAnswerAt",
        "status",
        "reason",
        "startedAt",
        "finishedAt",
    }
    assert respondent["lastValidAnswer"] == "B. 一般"
    assert respondent["reason"]


@pytest.mark.asyncio
async def test_analytics_and_exceptions_hide_cross_owner_rounds(exceptions_api) -> None:
    alice, bob, round_id = exceptions_api

    exception_response = await bob.get(f"/api/rounds/{round_id}/exceptions")
    analytics_response = await bob.post(
        f"/api/rounds/{round_id}/analytics/query",
        json={"questionId": "q1", "filters": {}, "groupBy": []},
    )
    missing_response = await alice.get(
        "/api/rounds/00000000-0000-0000-0000-000000000000/exceptions"
    )

    for response in (
        exception_response,
        analytics_response,
        missing_response,
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "RESOURCE_NOT_FOUND"
