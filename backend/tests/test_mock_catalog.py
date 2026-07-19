from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.schemas.survey import RespondentProfile


def test_default_templates_have_parallel_contracts() -> None:
    catalog = MockCatalog()
    zh = catalog.default_template("zh-CN")
    en = catalog.default_template("en-US")

    assert zh.title == "共同富裕可感可知问卷"
    assert en.title == "Common Prosperity Perception Survey"
    assert [item.id for item in zh.questions] == [item.id for item in en.questions]
    assert [item.type for item in zh.questions] == [item.type for item in en.questions]
    assert zh.questions[1].options == ["一般", "认同", "不认同"]
    assert en.questions[1].options == ["Neutral", "Agree", "Disagree"]


def test_catalogs_expose_localized_profile_and_analysis_data() -> None:
    catalog = MockCatalog()
    zh = catalog.data("zh-CN")
    en = catalog.data("en-US")

    assert zh.dimension_labels["gender"] == "性别"
    assert en.dimension_labels["gender"] == "Gender"
    assert zh.male_names and en.male_names
    assert zh.termination_phrases and en.termination_phrases
    assert zh.low_quality_termination_reason != en.low_quality_termination_reason


def test_default_templates_use_task_example_content_by_mode_and_locale() -> None:
    catalog = MockCatalog()

    zh_survey = catalog.default_template("zh-CN", "survey")
    zh_interview = catalog.default_template("zh-CN", "interview")
    en_survey = catalog.default_template("en-US", "survey")
    en_interview = catalog.default_template("en-US", "interview")

    assert zh_survey.title == "共同富裕可感可知问卷"
    assert zh_interview.title == "共同富裕可感可知访谈"
    assert en_survey.title == "Common Prosperity Perception Survey"
    assert en_interview.title == "Common Prosperity Perception Interview"
    assert zh_survey.questions[0].question == "您多大程度上认为您所在县（市、区）经济是快速发展的？"
    assert zh_interview.questions[0].question == "您觉得什么是共同富裕？"
    assert en_survey.questions[0].question == "To what extent do you think the economy in your county, city, or district is growing rapidly?"
    assert en_interview.questions[0].question == "What does common prosperity mean to you?"
    assert [item.type for item in zh_survey.questions] == [item.type for item in en_survey.questions]
    assert [item.type for item in zh_interview.questions] == [item.type for item in en_interview.questions]


def test_mock_answers_reuse_task_example_samples() -> None:
    catalog = MockCatalog()
    engine = MockEngine(catalog)
    respondent = RespondentProfile(
        id="respondent-1",
        name="测试用户",
        nickname="测试",
        avatar="",
        age=32,
        gender="男",
        occupation="企业职员",
        city="杭州",
        income="20万-50万",
        education="本科",
        maritalStatus="未婚",
        tags=[],
        configId="config-1",
    )

    survey_question = catalog.default_template("zh-CN", "survey").questions[0]
    survey_answer = engine.generate_answer(respondent, survey_question, "zh-CN", "survey")
    interview_question = catalog.default_template("zh-CN", "interview").questions[0]
    interview_answer = engine.generate_answer(
        respondent,
        interview_question,
        "zh-CN",
        "interview",
    )

    assert survey_answer.content in catalog.example_answers("zh-CN", "survey", survey_question.id)
    assert interview_answer.content in catalog.example_answers("zh-CN", "interview", interview_question.id)


def test_survey_mode_text_question_does_not_use_interview_examples() -> None:
    catalog = MockCatalog()
    engine = MockEngine(catalog)
    respondent = RespondentProfile(
        id="respondent-1",
        name="测试用户",
        nickname="测试",
        avatar="",
        age=32,
        gender="男",
        occupation="企业职员",
        city="杭州",
        income="20万-50万",
        education="本科",
        maritalStatus="未婚",
        tags=[],
        configId="config-1",
    )
    question = catalog.default_template("zh-CN", "survey").questions[0].model_copy(
        update={"type": "text", "options": None},
    )

    answer = engine.generate_answer(respondent, question, "zh-CN", "survey")

    assert answer.content not in catalog.example_answers("zh-CN", "interview", question.id)
