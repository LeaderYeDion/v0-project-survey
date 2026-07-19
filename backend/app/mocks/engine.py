import asyncio
import random
import re
from datetime import UTC, datetime
from uuid import uuid4

from app.locales import Locale
from app.mocks.catalog import MockCatalog
from app.schemas.survey import (
    ChoiceAnswer,
    DialogMessage,
    RespondentConfig,
    RespondentProfile,
    ScaleAnswer,
    SimulationMode,
    SurveyQuestion,
    TextAnswer,
)


class MockEngine:
    def __init__(
        self,
        catalog: MockCatalog,
        rng: random.Random | None = None,
        delay_scale: float = 1.0,
    ) -> None:
        self._catalog = catalog
        self._rng = rng or random.Random()
        self._delay_scale = delay_scale

    async def wait_before_question(self) -> None:
        await asyncio.sleep(0.3 * self._delay_scale)

    async def wait_before_answer(self) -> None:
        await asyncio.sleep(self._rng.uniform(0.8, 2.3) * self._delay_scale)

    def generate_respondents(
        self,
        configs: list[RespondentConfig],
        locale: Locale,
    ) -> list[RespondentProfile]:
        data = self._catalog.data(locale)
        result: list[RespondentProfile] = []
        for config in configs:
            for _ in range(config.count):
                is_male = config.gender == data.male_gender or (
                    config.gender == data.any_gender and self._rng.random() > 0.5
                )
                match = re.search(r"(\d+)[-~](\d+)", config.ageRange)
                age = (
                    self._rng.randint(int(match.group(1)), int(match.group(2)))
                    if match
                    else self._rng.randint(20, 49)
                )
                tags = [
                    data.age_tags[0]
                    if age < 30
                    else data.age_tags[1]
                    if age < 40
                    else data.age_tags[2]
                ]
                if any(marker in config.income for marker in data.high_income_markers):
                    tags.append(data.high_consumer_tag)
                elif any(marker in config.income for marker in data.value_income_markers):
                    tags.append(data.value_consumer_tag)
                if any(marker in config.occupation for marker in data.tech_occupation_markers):
                    tags.append(data.tech_tag)
                if any(marker in config.occupation for marker in data.creative_occupation_markers):
                    tags.append(data.creative_tag)
                if any(marker in config.occupation for marker in data.business_occupation_markers):
                    tags.append(data.business_tag)
                name_pool = data.male_names if is_male else data.female_names
                result.append(
                    RespondentProfile(
                        id=f"respondent-{uuid4()}",
                        name=self._rng.choice(name_pool),
                        nickname=self._rng.choice(data.nicknames),
                        avatar=self._rng.choice(data.avatars),
                        age=age,
                        gender=data.male_gender if is_male else data.female_gender,
                        occupation=config.occupation or data.default_occupation,
                        city=config.city or data.default_city,
                        income=config.income or data.default_income,
                        education=self._rng.choice(data.educations),
                        maritalStatus=self._rng.choice(data.marital_statuses),
                        tags=tags,
                        configId=config.id,
                    )
                )
        return result

    def generate_answer(
        self,
        respondent: RespondentProfile,
        question: SurveyQuestion,
        locale: Locale,
        mode: SimulationMode,
    ) -> DialogMessage:
        data = self._catalog.data(locale)
        sentiment = self._rng.choices(
            ["positive", "neutral", "negative"],
            weights=[0.4, 0.35, 0.25],
            k=1,
        )[0]
        example_answers = self._catalog.example_answers(
            locale,
            mode,
            question.id,
        )
        if example_answers:
            content = self._rng.choice(example_answers)
            answer = self._answer_value_from_example(question, content)
        elif question.type == "scale":
            assert question.scale is not None
            if sentiment == "positive":
                score = self._rng.randint(max(question.scale.min, question.scale.max - 2), question.scale.max)
            elif sentiment == "negative":
                score = self._rng.randint(question.scale.min, min(question.scale.max, question.scale.min + 2))
            else:
                midpoint = (question.scale.min + question.scale.max) // 2
                score = self._rng.randint(max(question.scale.min, midpoint - 1), min(question.scale.max, midpoint + 1))
            answer = ScaleAnswer(value=score)
            content = data.scale_answer_template.format(
                occupation=respondent.occupation,
                score=score,
            )
        elif question.type == "choice":
            selected = self._rng.choice(question.options or [""])
            answer = ChoiceAnswer(value=selected)
            content = data.choice_answer_template.format(
                selected=selected,
                age=respondent.age,
                gender=respondent.gender,
            )
        else:
            content = data.text_answer_template.format(
                city=respondent.city,
                occupation=respondent.occupation,
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

    def _answer_value_from_example(
        self,
        question: SurveyQuestion,
        content: str,
    ) -> TextAnswer | ChoiceAnswer | ScaleAnswer:
        if question.type == "scale":
            assert question.scale is not None
            match = re.search(r"\d+(?:\.\d+)?", content)
            if match:
                score = float(match.group(0))
                if score.is_integer():
                    score = int(score)
                return ScaleAnswer(value=score)
            return ScaleAnswer(value=question.scale.min)
        if question.type == "choice":
            selected = re.sub(r"^[A-Z]\.\s*", "", content).strip()
            return ChoiceAnswer(value=selected)
        return TextAnswer(value=content)

    def termination_message(self, locale: Locale) -> DialogMessage:
        return DialogMessage(
            id=f"message-{uuid4()}",
            role="respondent",
            content=self._rng.choice(self._catalog.data(locale).termination_phrases),
            timestamp=datetime.now(UTC),
            sentiment="negative",
        )

    def termination_reason(
        self,
        locale: Locale,
        actor: str,
        low_quality: bool = False,
    ) -> str:
        data = self._catalog.data(locale)
        if actor == "respondent":
            return data.respondent_termination_reason
        return (
            data.low_quality_termination_reason
            if low_quality
            else data.negative_termination_reason
        )

    def respondent_should_terminate(
        self,
        previous_dialog: list[DialogMessage],
    ) -> bool:
        return len(previous_dialog) > 2 and self._rng.random() < 0.1

    def response_is_low_quality(
        self,
        previous_dialog: list[DialogMessage],
    ) -> bool:
        return len(previous_dialog) > 4 and self._rng.random() < 0.15

    def interviewer_should_terminate(
        self,
        dialog: list[DialogMessage],
        low_quality: bool,
    ) -> bool:
        if low_quality and self._rng.random() < 0.5:
            return True
        negative_count = sum(
            message.role == "respondent" and message.sentiment == "negative"
            for message in dialog[-4:]
        )
        return negative_count >= 3 and self._rng.random() < 0.3
