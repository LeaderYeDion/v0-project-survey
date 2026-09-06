from datetime import UTC, datetime

from app.mocks.catalog import MockCatalog
from app.schemas.survey import (
    DialogMessage,
    InterviewSession,
    RespondentConfig,
    RespondentProfile,
    RunSnapshot,
    ScaleAnswer,
    SurveyConfig,
    SurveyQuestion,
)
from app.services.analytics_service import AnalyticsService


def _snapshot() -> RunSnapshot:
    now = datetime.now(UTC)
    configs = [
        RespondentConfig(
            id="hz",
            gender="all",
            ageRange="18-65",
            occupation="all",
            city="Hangzhou",
            income="all",
            count=3,
        ),
        RespondentConfig(
            id="sh",
            gender="all",
            ageRange="18-65",
            occupation="all",
            city="Shanghai",
            income="all",
            count=1,
        ),
    ]
    config = SurveyConfig(
        title="Scope",
        description="",
        questions=[
            SurveyQuestion(
                id="q1",
                type="scale",
                question="Score",
                scale={"min": 1, "max": 5},
            )
        ],
        maxResponseTime=30,
        respondentConfigs=configs,
    )
    profiles = [
        RespondentProfile(
            id=f"r{ordinal}",
            name=f"Person {ordinal}",
            nickname=f"P{ordinal}",
            avatar=str(ordinal),
            age=20 + ordinal,
            gender="woman" if ordinal in {1, 3} else "man",
            occupation="researcher",
            city="Hangzhou" if ordinal < 4 else "Shanghai",
            income="all",
            education="college",
            maritalStatus="single",
            tags=[],
            configId="hz" if ordinal < 4 else "sh",
        )
        for ordinal in range(1, 5)
    ]

    def answer(message_id: str, value: int) -> DialogMessage:
        return DialogMessage(
            id=message_id,
            role="respondent",
            content=str(value),
            timestamp=now,
            questionId="q1",
            answerValue=ScaleAnswer(value=value),
        )

    sessions = [
        InterviewSession(
            respondentId="r1",
            status="completed",
            completedQuestions=1,
            totalQuestions=1,
            dialog=[answer("m1", 3), answer("m2", 4)],
        ),
        InterviewSession(
            respondentId="r2",
            status="completed",
            completedQuestions=1,
            totalQuestions=1,
            dialog=[answer("m3", 5)],
        ),
        InterviewSession(
            respondentId="r3",
            status="terminated_by_respondent",
            completedQuestions=0,
            totalQuestions=1,
            dialog=[],
        ),
        InterviewSession(
            respondentId="r4",
            status="completed",
            completedQuestions=1,
            totalQuestions=1,
            dialog=[answer("m4", 2)],
        ),
    ]
    return RunSnapshot.empty(
        run_id="round-1",
        mode="survey",
        locale="en-US",
        config=config,
        created_at=now,
    ).model_copy(update={"respondents": profiles, "sessions": sessions})


def test_scope_distinguishes_people_from_valid_answers() -> None:
    result = AnalyticsService(MockCatalog()).query(
        _snapshot(),
        question_id="q1",
        filters={"city": "Hangzhou"},
        group_by=[],
    )

    assert result.scope.populationCount == 4
    assert result.scope.filteredRespondentCount == 3
    assert result.scope.validResponseCount == 2
    assert result.scope.excludedResponseCount == 1
    assert result.scope.filters == {"city": "Hangzhou"}
    assert result.scope.groupBy == []
    assert result.scope.label == "Work city: Hangzhou"
    assert result.scope.smallSample is True


def test_group_summaries_count_unique_people_and_valid_respondents() -> None:
    result = AnalyticsService(MockCatalog()).query(
        _snapshot(),
        question_id="q1",
        filters={"city": "Hangzhou"},
        group_by=["gender"],
    )

    assert [
        (group.label, group.respondentCount, group.validResponseCount)
        for group in result.groupedQuestionSummaries
    ] == [
        ("Gender: woman", 2, 1),
        ("Gender: man", 1, 1),
    ]


def test_small_sample_boundary_is_exclusive_of_thirty() -> None:
    snapshot = _snapshot()
    source = snapshot.respondents[0]
    session = snapshot.sessions[0]
    respondents = [
        source.model_copy(update={"id": f"sample-{index}"})
        for index in range(30)
    ]
    sessions = [
        session.model_copy(update={"respondentId": respondent.id})
        for respondent in respondents
    ]

    result = AnalyticsService(MockCatalog()).query(
        snapshot.model_copy(
            update={"respondents": respondents, "sessions": sessions}
        ),
        question_id="q1",
        filters={},
        group_by=[],
    )

    assert result.scope.validResponseCount == 30
    assert result.scope.smallSample is False
    assert result.scope.label == "Overall"
