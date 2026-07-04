import asyncio
import random
import re
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.survey import (
    ChoiceAnswer,
    DialogMessage,
    RespondentConfig,
    RespondentProfile,
    ScaleAnswer,
    SurveyConfig,
    SurveyQuestion,
    TextAnswer,
)

MALE_NAMES = ["张伟", "王强", "李明", "陈军", "刘洋", "孙磊", "周杰", "吴刚"]
FEMALE_NAMES = ["李娜", "王芳", "张敏", "刘静", "陈丽", "杨雪", "赵敏", "周琳"]
NICKNAMES = ["小王", "阿强", "大伟", "小李", "小刘", "阿杰", "小孙", "阿敏"]
EDUCATIONS = ["高中", "大专", "本科", "硕士", "博士"]
MARITAL_STATUSES = ["未婚", "已婚", "已婚有孩"]
AVATARS = ["👨‍💼", "👩‍💻", "👨‍🔬", "👩‍🎨", "👨‍🎤", "👩‍⚕️", "👨‍🍳", "👩‍🏫"]
TERMINATION_PHRASES = [
    "不好意思，我有点急事要处理，能改天再聊吗？",
    "抱歉，时间有点紧，我得先走了。",
    "我觉得问得差不多了，后面的问题我就不回答了。",
    "说实话，有些问题我不太想回答，就这样吧。",
]


def default_survey_config() -> SurveyConfig:
    return SurveyConfig(
        title="用户体验调研",
        description="了解用户对产品的使用体验和改进建议",
        maxResponseTime=30,
        respondentConfigs=[
            RespondentConfig(
                id="config-1", gender="男", ageRange="25-35",
                occupation="产品经理", city="北京", income="20-30万", count=3,
            ),
            RespondentConfig(
                id="config-2", gender="女", ageRange="22-30",
                occupation="软件工程师", city="上海", income="15-25万", count=2,
            ),
            RespondentConfig(
                id="config-3", gender="不限", ageRange="30-45",
                occupation="企业高管", city="深圳", income="50万以上", count=2,
            ),
        ],
        questions=[
            SurveyQuestion(
                id="q1", type="scale",
                question="请评价您对该产品的整体满意度（1-10分）",
                scale={"min": 1, "max": 10},
            ),
            SurveyQuestion(
                id="q2", type="choice", question="您最常使用哪个功能？",
                options=["搜索功能", "推荐系统", "个人中心", "社交分享"],
            ),
            SurveyQuestion(
                id="q3", type="text",
                question="您认为产品最需要改进的地方是什么？",
            ),
            SurveyQuestion(
                id="q4", type="choice",
                question="您会向朋友推荐这个产品吗？",
                options=["一定会", "可能会", "不确定", "可能不会", "一定不会"],
            ),
            SurveyQuestion(
                id="q5", type="text",
                question="请分享您最近一次使用产品的体验",
            ),
        ],
    )


class MockEngine:
    def __init__(
        self,
        rng: random.Random | None = None,
        delay_scale: float = 1.0,
    ) -> None:
        self.rng = rng or random.Random()
        self.delay_scale = delay_scale

    async def wait(self, seconds: float) -> None:
        await asyncio.sleep(seconds * self.delay_scale)

    def generate_respondents(
        self,
        configs: list[RespondentConfig],
    ) -> list[RespondentProfile]:
        result: list[RespondentProfile] = []
        for config in configs:
            for _ in range(config.count):
                is_male = config.gender == "男" or (
                    config.gender == "不限" and self.rng.random() > 0.5
                )
                match = re.search(r"(\d+)[-~](\d+)", config.ageRange)
                age = (
                    self.rng.randint(int(match.group(1)), int(match.group(2)))
                    if match
                    else self.rng.randint(20, 49)
                )
                tags = ["Z世代" if age < 30 else "职场中坚" if age < 40 else "资深人士"]
                if "50万以上" in config.income or "30-50" in config.income:
                    tags.append("高端消费")
                elif "10-15" in config.income or "15-20" in config.income:
                    tags.append("理性消费")
                if "工程师" in config.occupation or "程序员" in config.occupation:
                    tags.append("科技爱好者")
                if "设计" in config.occupation:
                    tags.append("文艺青年")
                if "经理" in config.occupation or "总监" in config.occupation:
                    tags.append("商务精英")
                name_pool = MALE_NAMES if is_male else FEMALE_NAMES
                result.append(
                    RespondentProfile(
                        id=f"respondent-{uuid4()}",
                        name=self.rng.choice(name_pool),
                        nickname=self.rng.choice(NICKNAMES),
                        avatar=self.rng.choice(AVATARS),
                        age=age,
                        gender="男" if is_male else "女",
                        occupation=config.occupation or "自由职业",
                        city=config.city or "北京",
                        income=config.income or "10-15万",
                        education=self.rng.choice(EDUCATIONS),
                        maritalStatus=self.rng.choice(MARITAL_STATUSES),
                        tags=tags,
                        configId=config.id,
                    )
                )
        return result

    def generate_answer(
        self,
        respondent: RespondentProfile,
        question: SurveyQuestion,
    ) -> DialogMessage:
        sentiment = self.rng.choices(
            ["positive", "neutral", "negative"],
            weights=[0.4, 0.35, 0.25],
            k=1,
        )[0]
        if question.type == "scale":
            assert question.scale is not None
            if sentiment == "positive":
                score = self.rng.randint(max(question.scale.min, question.scale.max - 2), question.scale.max)
            elif sentiment == "negative":
                score = self.rng.randint(question.scale.min, min(question.scale.max, question.scale.min + 2))
            else:
                midpoint = (question.scale.min + question.scale.max) // 2
                score = self.rng.randint(max(question.scale.min, midpoint - 1), min(question.scale.max, midpoint + 1))
            answer = ScaleAnswer(value=score)
            content = f"作为一个{respondent.occupation}，我给{score}分。"
        elif question.type == "choice":
            selected = self.rng.choice(question.options or [""])
            answer = ChoiceAnswer(value=selected)
            content = f'我选"{selected}"。作为{respondent.age}岁的{respondent.gender}性用户，这个选项最符合我的习惯。'
        else:
            content = (
                f"从我个人角度来说，作为在{respondent.city}工作的"
                f"{respondent.occupation}，我觉得最重要的是能够提升效率。"
            )
            answer = TextAnswer(value=content)
        return DialogMessage(
            id=f"message-{uuid4()}",
            role="respondent",
            content=content,
            timestamp=datetime.now(UTC),
            questionId=question.id,
            sentiment=sentiment,
            answerValue=answer,
        )

    def termination_message(self) -> DialogMessage:
        return DialogMessage(
            id=f"message-{uuid4()}",
            role="respondent",
            content=self.rng.choice(TERMINATION_PHRASES),
            timestamp=datetime.now(UTC),
            sentiment="negative",
        )

    def respondent_should_terminate(
        self,
        previous_dialog: list[DialogMessage],
    ) -> bool:
        return len(previous_dialog) > 2 and self.rng.random() < 0.1

    def response_is_low_quality(
        self,
        previous_dialog: list[DialogMessage],
    ) -> bool:
        return len(previous_dialog) > 4 and self.rng.random() < 0.15

    def interviewer_should_terminate(
        self,
        dialog: list[DialogMessage],
        low_quality: bool,
    ) -> bool:
        if low_quality and self.rng.random() < 0.5:
            return True
        negative_count = sum(
            message.role == "respondent" and message.sentiment == "negative"
            for message in dialog[-4:]
        )
        return negative_count >= 3 and self.rng.random() < 0.3
