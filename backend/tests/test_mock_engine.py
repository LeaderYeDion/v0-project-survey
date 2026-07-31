import random
from datetime import UTC, datetime

from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import DialogMessage, RespondentConfig, SurveyQuestion


CATALOG = MockCatalog()


class AlwaysTerminateRandom(random.Random):
    def random(self) -> float:
        return 0.0


def negative_dialog() -> list[DialogMessage]:
    return [
        DialogMessage(
            id=f"message-{index}",
            role="respondent",
            content="negative",
            timestamp=datetime.now(UTC),
            sentiment="negative",
        )
        for index in range(6)
    ]


def test_termination_is_disabled_by_default() -> None:
    engine = MockEngine(
        CATALOG,
        AlwaysTerminateRandom(),
        delay_scale=0,
    )
    dialog = negative_dialog()

    assert engine.respondent_should_terminate(dialog) is False
    assert engine.interviewer_should_terminate(dialog, low_quality=True) is False


def test_termination_can_be_enabled() -> None:
    engine = MockEngine(
        CATALOG,
        AlwaysTerminateRandom(),
        delay_scale=0,
        termination_enabled=True,
    )
    dialog = negative_dialog()

    assert engine.respondent_should_terminate(dialog) is True
    assert engine.interviewer_should_terminate(dialog, low_quality=True) is True


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
