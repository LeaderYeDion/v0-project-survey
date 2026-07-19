import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from app.locales import Locale
from app.schemas.survey import RespondentConfig, SimulationMode, SurveyConfig, SurveyQuestion

AVATARS = ("👨‍💼", "👩‍💻", "👨‍🔬", "👩‍🎨", "👨‍🎤", "👩‍⚕️", "👨‍🍳", "👩‍🏫")


@dataclass(frozen=True)
class MockLocaleData:
    title: str
    description: str
    respondent_configs: tuple[RespondentConfig, ...]
    questions: tuple[SurveyQuestion, ...]
    male_names: tuple[str, ...]
    female_names: tuple[str, ...]
    nicknames: tuple[str, ...]
    educations: tuple[str, ...]
    marital_statuses: tuple[str, ...]
    termination_phrases: tuple[str, ...]
    dimension_labels: Mapping[str, str]
    income_prefix: str
    male_gender: str
    female_gender: str
    any_gender: str
    default_occupation: str
    default_city: str
    default_income: str
    age_tags: tuple[str, str, str]
    high_consumer_tag: str
    value_consumer_tag: str
    tech_tag: str
    creative_tag: str
    business_tag: str
    high_income_markers: tuple[str, ...]
    value_income_markers: tuple[str, ...]
    tech_occupation_markers: tuple[str, ...]
    creative_occupation_markers: tuple[str, ...]
    business_occupation_markers: tuple[str, ...]
    scale_answer_template: str
    choice_answer_template: str
    text_answer_template: str
    respondent_termination_reason: str
    low_quality_termination_reason: str
    negative_termination_reason: str

    @property
    def avatars(self) -> tuple[str, ...]:
        return AVATARS


@dataclass(frozen=True)
class ExampleTemplateData:
    title: str
    description: str
    questions: tuple[SurveyQuestion, ...]
    answers_by_question: Mapping[str, tuple[str, ...]]


REPO_ROOT = Path(__file__).resolve().parents[3]
TASK_EXAMPLES_DIR = REPO_ROOT / "task_examples"

SURVEY_QUESTION_TRANSLATIONS = MappingProxyType({
    "您多大程度上认为您所在县（市、区）经济是快速发展的？": "To what extent do you think the economy in your county, city, or district is growing rapidly?",
    "您多大程度上认为您所在县（市、区）经济发展模式是可持续的？": "To what extent do you think the local economic development model is sustainable?",
    "您多大程度上认为您所在县（市、区）在过去几年中工作机会和薪资水平有所提升？": "To what extent do you think local job opportunities and wages have improved in recent years?",
    "您多大程度上认为您所在县（市、区）的政府在努力推动经济高质量发展？": "To what extent do you think the local government is working to promote high-quality economic development?",
    "您如何评价您所在县（市、区）的收入差距？": "How would you evaluate the income gap in your county, city, or district?",
    "您如何评价您所在县（市、区）的城乡差距？": "How would you evaluate the urban-rural gap in your county, city, or district?",
    "您如何评价您所在县（市、区）的区域差距？": "How would you evaluate regional disparities in your county, city, or district?",
    "您对您所在县（市、区）的教育公共服务感到满意吗？": "Are you satisfied with education public services in your county, city, or district?",
    "您对您所在县（市、区）的医疗公共服务感到满意吗？": "Are you satisfied with healthcare public services in your county, city, or district?",
    "您对您所在县（市、区）的养老公共服务感到满意吗？": "Are you satisfied with elderly care public services in your county, city, or district?",
    "您对您所在县（市、区）的托育公共服务感到满意吗？": "Are you satisfied with childcare public services in your county, city, or district?",
    "您对您所在县（市、区）的就业公共服务感到满意吗？": "Are you satisfied with employment public services in your county, city, or district?",
    "您对您所在县（市、区）的住房公共服务感到满意吗？": "Are you satisfied with housing public services in your county, city, or district?",
    "您对您所在县（市、区）的救助公共服务感到满意吗？": "Are you satisfied with assistance public services in your county, city, or district?",
    "您对您所在县（市、区）的交通公共服务感到满意吗？": "Are you satisfied with transportation public services in your county, city, or district?",
    "您多大程度上认为您所在县（市、区）的社会环境是安全稳定的？": "To what extent do you think the local social environment is safe and stable?",
    "您多大程度上认为您所在县（市、区）的社会是公平的？": "To what extent do you think local society is fair?",
    "您多大程度上认为您能参与社区或村庄事务？": "To what extent do you think you can participate in community or village affairs?",
    "您对当前共同富裕建设是否满意？": "Are you satisfied with current common prosperity development?",
    "您对未来共同富裕建设是否有信心？": "Are you confident about future common prosperity development?",
    "您多大程度上认为您所在县（市、区）在过去几年中治理水平有所改善？": "To what extent do you think local governance has improved in recent years?",
})

SURVEY_OPTION_TRANSLATIONS = MappingProxyType({
    "认同": "Agree",
    "不认同": "Disagree",
    "满意": "Satisfied",
    "不满意": "Dissatisfied",
    "有信心": "Confident",
    "没信心": "Not confident",
    "小": "Small",
    "大": "Large",
    "一般": "Neutral",
})

INTERVIEW_QUESTIONS_ZH = MappingProxyType({
    "问题3": "您觉得什么是共同富裕？",
    "问题4": "您觉得自己现在的收入水平怎么样？",
    "问题5": "您如何评价当前教育、医疗等公共服务的质量和可获得性？",
    "问题6": "综合看来，在目前社会中您认为自己处于哪个阶层？为什么？",
    "问题7": "共同富裕实施这几年，您是否感受到向上流动的机会更多了？",
    "问题8": "您对未来共同富裕建设有什么期待？",
})

INTERVIEW_QUESTIONS_EN = MappingProxyType({
    "问题3": "What does common prosperity mean to you?",
    "问题4": "How would you describe your current income level?",
    "问题5": "How do you evaluate the quality and accessibility of public services such as education and healthcare?",
    "问题6": "Overall, where do you think you stand in today's social hierarchy, and why?",
    "问题7": "In recent years of common prosperity development, have you felt that upward mobility opportunities have increased?",
    "问题8": "What expectations do you have for the future of common prosperity development?",
})

INTERVIEW_ANSWER_TRANSLATIONS = MappingProxyType({
    "问题3": (
        "I think common prosperity has two parts: prosperity for everyone, not just a small group, and prosperity that is comprehensive. Beyond material life, it should also include a sense of spiritual fulfillment.",
        "To me, common prosperity first means eliminating absolute poverty. It means using tools like public support and tax policy so more people can live better lives, with people's well-being at the center.",
        "I understand common prosperity as people in different jobs and social roles sharing the benefits brought by social development, both materially and in daily life.",
        "For me, it comes down to care for the elderly, support for children, and access to healthcare when people are ill.",
    ),
    "问题4": (
        "It is very low.",
        "There has not been much change. Five years ago I was still a student, and now I am still a student.",
        "Since the common prosperity initiative began, income has increased relatively quickly in recent years, though the pandemic also had an impact.",
        "I am still an intern, but compared with the average worker I think the level is relatively high.",
    ),
    "问题5": (
        "Education does not make much difference for someone my age. Healthcare feels convenient for older people, and some treatments can be free or discounted, although I cannot explain every detail.",
        "For education, accessibility is quite strong because of compulsory education and relatively affordable schooling. Quality is uneven, but most people can at least obtain education.",
        "I think public services have improved in coverage, especially basic education and medical insurance, but experiences can still vary by region and by family resources.",
        "I pay more attention to healthcare. It is easier to access than before, but waiting time, reimbursement, and service quality still create pressure.",
    ),
    "问题6": (
        "Maybe around 2 or 3. At least I am not at the very bottom, but only a little better than that.",
        "I think I am in the lower-middle level of society, around a 3.",
        "I would say 5, because life is stable but my goals have not been fully reached.",
        "Probably middle level. Basic living needs are met, but housing, education, and long-term development still bring pressure.",
    ),
    "问题7": (
        "What exactly do you mean by upward mobility opportunities?",
        "For my own development, I have not felt a particularly obvious increase in upward mobility.",
        "Personally I have not felt it. I still think crossing social classes is very difficult, especially with growing employment pressure.",
        "No.",
    ),
    "问题8": (
        "I hope people can have freedom over their own affairs, time, and thoughts, instead of being restricted in what they want to read or think about.",
        "I just hope to cook at home and live peacefully. Being settled at home feels happiest.",
        "I hope common prosperity can reduce pressure around housing, healthcare, food safety, and education, so ordinary families can live steadily and have the energy to enjoy life.",
        "This question feels too big for me. As an individual I can express opinions, but I cannot really change much.",
    ),
})


def _load_task_example(name: str) -> list[dict[str, object]]:
    path = TASK_EXAMPLES_DIR / name / "example.json"
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def _extract_options(instruction: str) -> list[str]:
    options: list[str] = []
    for match in re.finditer(r"^[A-Z]\.\s*(.+)$", instruction, flags=re.MULTILINE):
        options.append(match.group(1).strip())
    return options


def _unique_preserving_order(values: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(item for item in values if item))


def _build_survey_examples(locale: Locale) -> ExampleTemplateData:
    raw_items = _load_task_example("survey")
    by_index: dict[int, dict[str, object]] = {}
    answers_by_index: dict[int, list[str]] = defaultdict(list)
    for item in raw_items:
        question_index = int(item["question_index"])
        by_index.setdefault(question_index, item)
        answers_by_index[question_index].append(str(item["output"]).strip())

    questions: list[SurveyQuestion] = []
    answers_by_question: dict[str, tuple[str, ...]] = {}
    for position, question_index in enumerate(sorted(by_index), start=1):
        item = by_index[question_index]
        question_text = str(item["question"])
        options = _extract_options(str(item["instruction"]))
        question_id = f"q{position}"
        if locale == "en-US":
            question_text = SURVEY_QUESTION_TRANSLATIONS.get(question_text, question_text)
            options = [SURVEY_OPTION_TRANSLATIONS.get(option, option) for option in options]
            answers = tuple(
                _translate_choice_answer(answer)
                for answer in _unique_preserving_order(answers_by_index[question_index])
            )
        else:
            answers = _unique_preserving_order(answers_by_index[question_index])
        questions.append(
            SurveyQuestion(
                id=question_id,
                type="choice",
                question=question_text,
                options=options,
            )
        )
        answers_by_question[question_id] = answers

    if locale == "zh-CN":
        return ExampleTemplateData(
            title="共同富裕可感可知问卷",
            description="基于共同富裕可感可知问卷样例生成的默认调研配置。",
            questions=tuple(questions),
            answers_by_question=MappingProxyType(answers_by_question),
        )
    return ExampleTemplateData(
        title="Common Prosperity Perception Survey",
        description="Default survey configuration generated from common prosperity perception examples.",
        questions=tuple(questions),
        answers_by_question=MappingProxyType(answers_by_question),
    )


def _translate_choice_answer(answer: str) -> str:
    match = re.match(r"^([A-Z]\.\s*)?(.+)$", answer)
    if match is None:
        return answer
    prefix = match.group(1) or ""
    value = match.group(2).strip()
    return f"{prefix}{SURVEY_OPTION_TRANSLATIONS.get(value, value)}"


def _build_interview_examples(locale: Locale) -> ExampleTemplateData:
    raw_items = _load_task_example("chat")
    answer_translations = INTERVIEW_ANSWER_TRANSLATIONS if locale == "en-US" else {}
    grouped_answers: dict[str, list[str]] = defaultdict(list)
    for item in raw_items:
        grouped_answers[str(item["qua"])].append(str(item["output"]).strip())

    question_labels = INTERVIEW_QUESTIONS_EN if locale == "en-US" else INTERVIEW_QUESTIONS_ZH
    questions: list[SurveyQuestion] = []
    answers_by_question: dict[str, tuple[str, ...]] = {}
    for position, qua in enumerate(sorted(question_labels), start=1):
        question_id = f"q{position}"
        questions.append(
            SurveyQuestion(
                id=question_id,
                type="text",
                question=question_labels[qua],
            )
        )
        answers = answer_translations.get(qua)
        if answers is None:
            answers = _unique_preserving_order(grouped_answers[qua])
        answers_by_question[question_id] = tuple(answers)

    if locale == "zh-CN":
        return ExampleTemplateData(
            title="共同富裕可感可知访谈",
            description="基于共同富裕可感可知访谈样例生成的默认访谈提纲。",
            questions=tuple(questions),
            answers_by_question=MappingProxyType(answers_by_question),
        )
    return ExampleTemplateData(
        title="Common Prosperity Perception Interview",
        description="Default interview guide generated from common prosperity perception examples.",
        questions=tuple(questions),
        answers_by_question=MappingProxyType(answers_by_question),
    )


ZH_CN = MockLocaleData(
    title="用户体验调研",
    description="了解用户对产品的使用体验和改进建议",
    respondent_configs=(
        RespondentConfig(id="config-1", gender="男", ageRange="25-35", occupation="产品经理", city="北京", income="20-30万", count=3),
        RespondentConfig(id="config-2", gender="女", ageRange="22-30", occupation="软件工程师", city="上海", income="15-25万", count=2),
        RespondentConfig(id="config-3", gender="不限", ageRange="30-45", occupation="企业高管", city="深圳", income="50万以上", count=2),
    ),
    questions=(
        SurveyQuestion(id="q1", type="scale", question="请评价您对该产品的整体满意度（1-10分）", scale={"min": 1, "max": 10}),
        SurveyQuestion(id="q2", type="choice", question="您最常使用哪个功能？", options=["搜索功能", "推荐系统", "个人中心", "社交分享"]),
        SurveyQuestion(id="q3", type="text", question="您认为产品最需要改进的地方是什么？"),
        SurveyQuestion(id="q4", type="choice", question="您会向朋友推荐这个产品吗？", options=["一定会", "可能会", "不确定", "可能不会", "一定不会"]),
        SurveyQuestion(id="q5", type="text", question="请分享您最近一次使用产品的体验"),
    ),
    male_names=("张伟", "王强", "李明", "陈军", "刘洋", "孙磊", "周杰", "吴刚"),
    female_names=("李娜", "王芳", "张敏", "刘静", "陈丽", "杨雪", "赵敏", "周琳"),
    nicknames=("小王", "阿强", "大伟", "小李", "小刘", "阿杰", "小孙", "阿敏"),
    educations=("高中", "大专", "本科", "硕士", "博士"),
    marital_statuses=("未婚", "已婚", "已婚有孩"),
    termination_phrases=(
        "不好意思，我有点急事要处理，能改天再聊吗？",
        "抱歉，时间有点紧，我得先走了。",
        "我觉得问得差不多了，后面的问题我就不回答了。",
        "说实话，有些问题我不太想回答，就这样吧。",
    ),
    dimension_labels=MappingProxyType({"gender": "性别", "ageRange": "年龄段", "occupation": "职业", "city": "工作城市", "income": "收入区间"}),
    income_prefix="收入",
    male_gender="男",
    female_gender="女",
    any_gender="不限",
    default_occupation="自由职业",
    default_city="北京",
    default_income="10-15万",
    age_tags=("Z世代", "职场中坚", "资深人士"),
    high_consumer_tag="高端消费",
    value_consumer_tag="理性消费",
    tech_tag="科技爱好者",
    creative_tag="文艺青年",
    business_tag="商务精英",
    high_income_markers=("50万以上", "30-50"),
    value_income_markers=("10-15", "15-20"),
    tech_occupation_markers=("工程师", "程序员"),
    creative_occupation_markers=("设计",),
    business_occupation_markers=("经理", "总监"),
    scale_answer_template="作为一个{occupation}，我给{score}分。",
    choice_answer_template='我选"{selected}"。作为{age}岁的{gender}性用户，这个选项最符合我的习惯。',
    text_answer_template="从我个人角度来说，作为在{city}工作的{occupation}，我觉得最重要的是能够提升效率。",
    respondent_termination_reason="受访者主动结束对话",
    low_quality_termination_reason="受访者回答质量较低，调研方决定提前结束",
    negative_termination_reason="受访者态度消极，调研方决定终止访谈",
)

EN_US = MockLocaleData(
    title="User Experience Survey",
    description="Understand how people use the product and where it can improve",
    respondent_configs=(
        RespondentConfig(id="config-1", gender="Male", ageRange="25-35", occupation="Product Manager", city="New York", income="$100k-$150k", count=3),
        RespondentConfig(id="config-2", gender="Female", ageRange="22-30", occupation="Software Engineer", city="San Francisco", income="$80k-$120k", count=2),
        RespondentConfig(id="config-3", gender="Any", ageRange="30-45", occupation="Business Executive", city="Seattle", income="$200k+", count=2),
    ),
    questions=(
        SurveyQuestion(id="q1", type="scale", question="How satisfied are you with the product overall? (1-10)", scale={"min": 1, "max": 10}),
        SurveyQuestion(id="q2", type="choice", question="Which feature do you use most often?", options=["Search", "Recommendations", "Profile", "Social sharing"]),
        SurveyQuestion(id="q3", type="text", question="What area of the product most needs improvement?"),
        SurveyQuestion(id="q4", type="choice", question="Would you recommend this product to a friend?", options=["Definitely", "Probably", "Not sure", "Probably not", "Definitely not"]),
        SurveyQuestion(id="q5", type="text", question="Tell us about your most recent experience using the product."),
    ),
    male_names=("James", "Michael", "David", "Daniel", "William", "Joseph", "Thomas", "Ethan"),
    female_names=("Emma", "Olivia", "Sophia", "Ava", "Mia", "Isabella", "Amelia", "Grace"),
    nicknames=("Alex", "Sam", "Jamie", "Taylor", "Jordan", "Casey", "Morgan", "Riley"),
    educations=("High school", "Associate degree", "Bachelor's degree", "Master's degree", "Doctorate"),
    marital_statuses=("Single", "Married", "Married with children"),
    termination_phrases=(
        "Sorry, something urgent came up. Could we continue another time?",
        "I'm short on time and need to leave now.",
        "I think we've covered enough, so I'd rather stop here.",
        "I'd prefer not to answer any more questions.",
    ),
    dimension_labels=MappingProxyType({"gender": "Gender", "ageRange": "Age range", "occupation": "Occupation", "city": "Work city", "income": "Income range"}),
    income_prefix="Income",
    male_gender="Male",
    female_gender="Female",
    any_gender="Any",
    default_occupation="Freelancer",
    default_city="New York",
    default_income="$50k-$80k",
    age_tags=("Gen Z", "Mid-career professional", "Experienced professional"),
    high_consumer_tag="Premium consumer",
    value_consumer_tag="Value-conscious consumer",
    tech_tag="Tech enthusiast",
    creative_tag="Creative",
    business_tag="Business professional",
    high_income_markers=("$200k+", "$150k-$200k"),
    value_income_markers=("$50k-$80k", "$80k-$100k"),
    tech_occupation_markers=("Engineer", "Developer"),
    creative_occupation_markers=("Designer",),
    business_occupation_markers=("Manager", "Director", "Executive"),
    scale_answer_template="As a {occupation}, I would rate it {score} out of 10.",
    choice_answer_template='I chose "{selected}." As a {age}-year-old {gender} user, it best matches my habits.',
    text_answer_template="From my perspective, as a {occupation} working in {city}, the most important improvement would be helping people work more efficiently.",
    respondent_termination_reason="The respondent chose to end the conversation",
    low_quality_termination_reason="The researcher ended the interview because the responses were low quality",
    negative_termination_reason="The researcher ended the interview because the respondent remained negative",
)


class MockCatalog:
    _catalogs = {"zh-CN": ZH_CN, "en-US": EN_US}
    _examples = MappingProxyType({
        ("zh-CN", "survey"): _build_survey_examples("zh-CN"),
        ("en-US", "survey"): _build_survey_examples("en-US"),
        ("zh-CN", "interview"): _build_interview_examples("zh-CN"),
        ("en-US", "interview"): _build_interview_examples("en-US"),
    })

    def data(self, locale: Locale) -> MockLocaleData:
        return self._catalogs[locale]

    def default_template(
        self,
        locale: Locale,
        mode: SimulationMode = "survey",
    ) -> SurveyConfig:
        data = self._examples[(locale, mode)]
        return SurveyConfig(
            title=data.title,
            description=data.description,
            maxResponseTime=30,
            respondentConfigs=[
                item.model_copy(deep=True)
                for item in self.data(locale).respondent_configs
            ],
            questions=[item.model_copy(deep=True) for item in data.questions],
        )

    def example_answers(
        self,
        locale: Locale,
        mode: SimulationMode,
        question_id: str,
    ) -> tuple[str, ...]:
        return self._examples[(locale, mode)].answers_by_question.get(question_id, ())

    def dimension_labels(self, locale: Locale) -> Mapping[str, str]:
        return self.data(locale).dimension_labels

    def income_group_label(self, locale: Locale, value: str) -> str:
        return f"{self.data(locale).income_prefix}: {value}"
