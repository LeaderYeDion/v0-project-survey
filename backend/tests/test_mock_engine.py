import random

from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import RespondentConfig, SurveyQuestion


CATALOG = MockCatalog()


def test_default_template_matches_existing_demo() -> None:
    config = CATALOG.default_template("zh-CN")
    assert config.title == "共同富裕可感可知问卷"
    assert len(config.questions) >= 20
    assert sum(item.count for item in config.respondentConfigs) == 7


def test_generate_respondents_honors_count_and_config() -> None:
    engine = MockEngine(CATALOG, random.Random(1), delay_scale=0)
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
        ],
        "zh-CN",
    )

    assert len(respondents) == 3
    assert {item.gender for item in respondents} == {"男"}
    assert {item.configId for item in respondents} == {"group-1"}


def test_text_answer_keeps_text_type() -> None:
    engine = MockEngine(CATALOG, random.Random(2), delay_scale=0)
    respondent = engine.generate_respondents(
        CATALOG.default_template("zh-CN").respondentConfigs,
        "zh-CN",
    )[0]
    message = engine.generate_answer(
        respondent,
        SurveyQuestion(id="text-1", type="text", question="建议？"),
        "zh-CN",
        "survey",
    )

    assert message.answerValue is not None
    assert message.answerValue.type == "text"


def test_english_engine_generates_english_profile_and_answer() -> None:
    engine = MockEngine(CATALOG, random.Random(2), delay_scale=0)
    config = CATALOG.default_template("en-US", "interview")
    respondent = engine.generate_respondents(
        config.respondentConfigs,
        "en-US",
    )[0]
    message = engine.generate_answer(
        respondent,
        config.questions[2],
        "en-US",
        "interview",
    )

    assert respondent.gender in {"Male", "Female"}
    assert respondent.education in CATALOG.data("en-US").educations
    assert message.answerValue is not None
    assert message.answerValue.type == "text"
    assert message.content in CATALOG.example_answers(
        "en-US",
        "interview",
        config.questions[2].id,
    )
