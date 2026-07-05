from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from app.locales import Locale
from app.schemas.survey import RespondentConfig, SurveyConfig, SurveyQuestion

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

    def data(self, locale: Locale) -> MockLocaleData:
        return self._catalogs[locale]

    def default_template(self, locale: Locale) -> SurveyConfig:
        data = self.data(locale)
        return SurveyConfig(
            title=data.title,
            description=data.description,
            maxResponseTime=30,
            respondentConfigs=[item.model_copy(deep=True) for item in data.respondent_configs],
            questions=[item.model_copy(deep=True) for item in data.questions],
        )

    def dimension_labels(self, locale: Locale) -> Mapping[str, str]:
        return self.data(locale).dimension_labels

    def income_group_label(self, locale: Locale, value: str) -> str:
        return f"{self.data(locale).income_prefix}: {value}"
