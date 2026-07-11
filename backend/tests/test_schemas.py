from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.survey import (
    CreateRunRequest,
    RunSnapshot,
    SurveyHistoryRecord,
    SurveyConfig,
    SurveyQuestion,
)


def test_choice_question_requires_options() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestion(id="q1", type="choice", question="选择？", options=[])


def test_scale_question_requires_ordered_range() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestion(
            id="q1",
            type="scale",
            question="评分？",
            scale={"min": 10, "max": 1},
        )


def test_run_requires_questions_and_respondents() -> None:
    with pytest.raises(ValidationError):
        CreateRunRequest(
            mode="survey",
            config=SurveyConfig(
                title="空调研",
                description="",
                maxResponseTime=30,
                questions=[],
                respondentConfigs=[],
            ),
        )


def test_empty_run_persists_locale() -> None:
    config = SurveyConfig(
        title="Test",
        description="",
        maxResponseTime=30,
        questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
        respondentConfigs=[
            {
                "id": "group-1",
                "gender": "Any",
                "ageRange": "20-30",
                "occupation": "Engineer",
                "city": "Seattle",
                "income": "$100k-$150k",
                "count": 1,
            }
        ],
    )

    snapshot = RunSnapshot.empty(
        run_id="run-1",
        mode="survey",
        locale="en-US",
        config=config,
        created_at=datetime.now(UTC),
    )

    assert snapshot.locale == "en-US"


def test_survey_config_accepts_missing_inference_config() -> None:
    config = SurveyConfig(
        title="Interview",
        description="",
        maxResponseTime=30,
        questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
        respondentConfigs=[
            {
                "id": "group-1",
                "gender": "不限",
                "ageRange": "25-35",
                "occupation": "研究员",
                "city": "杭州",
                "income": "20万-50万",
                "count": 1,
            }
        ],
    )

    assert config.inferenceConfig is None


def test_profile_inference_task_requires_options() -> None:
    with pytest.raises(ValidationError):
        SurveyConfig(
            title="Interview",
            description="",
            maxResponseTime=30,
            questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
            respondentConfigs=[
                {
                    "id": "group-1",
                    "gender": "不限",
                    "ageRange": "25-35",
                    "occupation": "研究员",
                    "city": "杭州",
                    "income": "20万-50万",
                    "count": 1,
                }
            ],
            inferenceConfig={
                "enabled": True,
                "profileEnabled": True,
                "attitudeEnabled": False,
                "profileTasks": [
                    {
                        "id": "profile-income",
                        "name": "家庭年收入",
                        "options": [],
                        "multiple": False,
                        "enabled": True,
                    }
                ],
                "attitudeTasks": [],
            },
        )


def test_run_snapshot_defaults_inference_fields_when_omitted() -> None:
    config = SurveyConfig(
        title="Test",
        description="",
        maxResponseTime=30,
        questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
        respondentConfigs=[
            {
                "id": "group-1",
                "gender": "Any",
                "ageRange": "20-30",
                "occupation": "Engineer",
                "city": "Seattle",
                "income": "$100k-$150k",
                "count": 1,
            }
        ],
    )

    snapshot = RunSnapshot(
        id="run-1",
        mode="survey",
        locale="en-US",
        status="completed",
        config=config,
        respondents=[],
        sessions=[],
        progress={
            "totalRespondents": 0,
            "completedRespondents": 0,
            "inProgressRespondents": 0,
            "terminatedRespondents": 0,
            "currentRespondentIndex": 0,
        },
        sentiment={"positive": 0, "neutral": 0, "negative": 0},
        questionAnalysis=[],
        demographicAnalysis=[],
        responses=[],
        activeRespondentId=None,
        createdAt=datetime.now(UTC),
        startedAt=None,
        finishedAt=None,
        error=None,
    )

    assert snapshot.inferenceResults == []
    assert snapshot.inferenceSummary == []


def test_history_record_defaults_inference_fields_when_omitted() -> None:
    config = SurveyConfig(
        title="Test",
        description="",
        maxResponseTime=30,
        questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
        respondentConfigs=[
            {
                "id": "group-1",
                "gender": "Any",
                "ageRange": "20-30",
                "occupation": "Engineer",
                "city": "Seattle",
                "income": "$100k-$150k",
                "count": 1,
            }
        ],
    )

    record = SurveyHistoryRecord(
        id="history-1",
        runId="run-1",
        mode="survey",
        locale="en-US",
        savedAt=datetime.now(UTC),
        config=config,
        sessions=[],
        respondents=[],
        progress={
            "totalRespondents": 0,
            "completedRespondents": 0,
            "inProgressRespondents": 0,
            "terminatedRespondents": 0,
            "currentRespondentIndex": 0,
        },
        sentiment={"positive": 0, "neutral": 0, "negative": 0},
        questionAnalysis=[],
        demographicAnalysis=[],
        responses=[],
    )

    assert record.inferenceResults == []
    assert record.inferenceSummary == []
