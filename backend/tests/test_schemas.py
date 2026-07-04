import pytest
from pydantic import ValidationError

from app.schemas.survey import CreateRunRequest, SurveyConfig, SurveyQuestion


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
