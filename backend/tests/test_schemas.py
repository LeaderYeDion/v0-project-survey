from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas.survey import (
    CreateRunRequest,
    RunSnapshot,
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
