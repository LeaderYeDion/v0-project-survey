from datetime import UTC, datetime

from app.schemas.analytics import AnalyticsQuery
from app.schemas.survey import (
    DialogMessage,
    InterviewSession,
    RespondentConfig,
    RespondentProfile,
    RunSnapshot,
    ScaleAnswer,
    SurveyConfig,
    SurveyProgress,
    SurveyQuestion,
    TextAnswer,
)
from app.services.analytics_service import AnalyticsService


def build_snapshot() -> RunSnapshot:
    questions = [
        SurveyQuestion(
            id="scale-1",
            type="scale",
            question="评分？",
            scale={"min": 1, "max": 10},
        ),
        SurveyQuestion(id="text-1", type="text", question="建议？"),
    ]
    config = SurveyConfig(
        title="测试",
        description="",
        maxResponseTime=30,
        questions=questions,
        respondentConfigs=[
            RespondentConfig(
                id="g1",
                gender="男",
                ageRange="20-30",
                occupation="产品经理",
                city="北京",
                income="20-30万",
                count=1,
            ),
            RespondentConfig(
                id="g2",
                gender="女",
                ageRange="30-40",
                occupation="工程师",
                city="上海",
                income="30-50万",
                count=1,
            ),
        ],
    )
    respondents = [
        RespondentProfile(
            id="r1",
            name="甲",
            nickname="甲",
            avatar="A",
            age=25,
            gender="男",
            occupation="产品经理",
            city="北京",
            income="20-30万",
            education="本科",
            maritalStatus="未婚",
            tags=[],
            configId="g1",
        ),
        RespondentProfile(
            id="r2",
            name="乙",
            nickname="乙",
            avatar="B",
            age=35,
            gender="女",
            occupation="工程师",
            city="上海",
            income="30-50万",
            education="本科",
            maritalStatus="已婚",
            tags=[],
            configId="g2",
        ),
    ]
    now = datetime.now(UTC)
    sessions = [
        InterviewSession(
            respondentId="r1",
            status="completed",
            completedQuestions=2,
            totalQuestions=2,
            startTime=now,
            endTime=now,
            dialog=[
                DialogMessage(
                    id="m1",
                    role="respondent",
                    content="6分",
                    timestamp=now,
                    questionId="scale-1",
                    sentiment="neutral",
                    answerValue=ScaleAnswer(value=6),
                ),
                DialogMessage(
                    id="m2",
                    role="respondent",
                    content="更快",
                    timestamp=now,
                    questionId="text-1",
                    sentiment="positive",
                    answerValue=TextAnswer(value="更快"),
                ),
            ],
        ),
        InterviewSession(
            respondentId="r2",
            status="completed",
            completedQuestions=2,
            totalQuestions=2,
            startTime=now,
            endTime=now,
            dialog=[
                DialogMessage(
                    id="m3",
                    role="respondent",
                    content="8分",
                    timestamp=now,
                    questionId="scale-1",
                    sentiment="positive",
                    answerValue=ScaleAnswer(value=8),
                )
            ],
        ),
    ]
    return RunSnapshot.empty(
        run_id="run-1",
        mode="survey",
        config=config,
        created_at=now,
    ).model_copy(
        update={
            "respondents": respondents,
            "sessions": sessions,
            "progress": SurveyProgress(
                totalRespondents=2,
                completedRespondents=2,
                inProgressRespondents=0,
                terminatedRespondents=0,
                currentRespondentIndex=1,
            ),
        }
    )


def test_question_analysis_and_typed_responses() -> None:
    snapshot = build_snapshot()
    service = AnalyticsService()

    analysis = service.analyze_questions(
        snapshot.sessions,
        snapshot.config.questions,
    )
    assert analysis[0].totalResponses == 2
    assert analysis[0].averageScore == 7.0
    assert analysis[0].responseDistribution == {"6": 1, "8": 1}

    responses = service.build_responses(
        snapshot.sessions,
        snapshot.id,
        snapshot.config.questions,
    )
    assert responses[0].answers["text-1"].type == "text"


def test_filter_and_multi_dimension_group() -> None:
    snapshot = build_snapshot()
    result = AnalyticsService().query(
        snapshot,
        AnalyticsQuery(
            questionId="scale-1",
            filters={"city": "北京"},
            groupBy=["gender", "income"],
        ),
    )

    assert result.filteredRespondentCount == 1
    assert result.groupedQuestionSummaries[0].respondentCount == 1
