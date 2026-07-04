import random

from app.schemas.survey import RespondentConfig, SurveyQuestion
from app.services.mock_engine import MockEngine, default_survey_config


def test_default_template_matches_existing_demo() -> None:
    config = default_survey_config()
    assert config.title == "用户体验调研"
    assert len(config.questions) == 5
    assert sum(item.count for item in config.respondentConfigs) == 7


def test_generate_respondents_honors_count_and_config() -> None:
    engine = MockEngine(random.Random(1), delay_scale=0)
    respondents = engine.generate_respondents(
        [
            RespondentConfig(
                id="group-1",
                gender="男",
                ageRange="25-35",
                occupation="产品经理",
                city="北京",
                income="20-30万",
                count=3,
            )
        ]
    )

    assert len(respondents) == 3
    assert {item.gender for item in respondents} == {"男"}
    assert {item.configId for item in respondents} == {"group-1"}


def test_text_answer_keeps_text_type() -> None:
    engine = MockEngine(random.Random(2), delay_scale=0)
    respondent = engine.generate_respondents(
        default_survey_config().respondentConfigs
    )[0]
    message = engine.generate_answer(
        respondent,
        SurveyQuestion(id="text-1", type="text", question="建议？"),
    )

    assert message.answerValue is not None
    assert message.answerValue.type == "text"
