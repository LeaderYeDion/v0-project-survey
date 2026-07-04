from collections import Counter

from app.schemas.analytics import (
    AnalyticsQuery,
    AnalyticsQueryResult,
    DimensionMetadata,
    GroupedQuestionSummary,
)
from app.schemas.survey import (
    ChoiceAnswer,
    DemographicAnalysis,
    InterviewSession,
    QuestionAnalysis,
    RespondentConfig,
    RespondentProfile,
    RunSnapshot,
    ScaleAnswer,
    SentimentData,
    SurveyQuestion,
    SurveyResponse,
    TextAnswer,
)

DIMENSION_LABELS = {
    "gender": "性别",
    "ageRange": "年龄段",
    "occupation": "职业",
    "city": "工作城市",
    "income": "收入区间",
}


class AnalyticsService:
    def analyze_sentiment(
        self,
        sessions: list[InterviewSession],
    ) -> SentimentData:
        counts = Counter(
            message.sentiment
            for session in sessions
            for message in session.dialog
            if message.role == "respondent" and message.sentiment
        )
        total = sum(counts.values())
        if total == 0:
            return SentimentData(positive=0, neutral=0, negative=0)
        return SentimentData(
            positive=round(counts["positive"] / total * 100),
            neutral=round(counts["neutral"] / total * 100),
            negative=round(counts["negative"] / total * 100),
        )

    def analyze_questions(
        self,
        sessions: list[InterviewSession],
        questions: list[SurveyQuestion],
    ) -> list[QuestionAnalysis]:
        result: list[QuestionAnalysis] = []
        for question in questions:
            values = [
                message.answerValue.value
                for session in sessions
                for message in session.dialog
                if message.role == "respondent"
                and message.questionId == question.id
                and message.answerValue is not None
            ]
            distribution = Counter(str(value) for value in values)
            average = None
            if question.type == "scale" and values:
                average = sum(float(value) for value in values) / len(values)
            result.append(
                QuestionAnalysis(
                    questionId=question.id,
                    questionText=question.question,
                    questionType=question.type,
                    totalResponses=len(values),
                    responseDistribution=dict(distribution),
                    averageScore=average,
                )
            )
        return result

    def analyze_demographics(
        self,
        sessions: list[InterviewSession],
        respondents: list[RespondentProfile],
        questions: list[SurveyQuestion],
    ) -> list[DemographicAnalysis]:
        result: list[DemographicAnalysis] = []
        session_map = {session.respondentId: session for session in sessions}
        for question in questions:
            dimensions = [
                (city, [item for item in respondents if item.city == city])
                for city in dict.fromkeys(item.city for item in respondents)
            ]
            dimensions += [
                (
                    f"收入:{income}",
                    [item for item in respondents if item.income == income],
                )
                for income in dict.fromkeys(item.income for item in respondents)
            ]
            for label, members in dimensions:
                values = [
                    message.answerValue.value
                    for respondent in members
                    for message in session_map.get(
                        respondent.id,
                        InterviewSession(
                            respondentId=respondent.id,
                            status="pending",
                            completedQuestions=0,
                            totalQuestions=len(questions),
                        ),
                    ).dialog
                    if message.role == "respondent"
                    and message.questionId == question.id
                    and message.answerValue is not None
                ]
                if values:
                    result.append(
                        DemographicAnalysis(
                            tagName=label,
                            questionId=question.id,
                            questionText=question.question,
                            responseDistribution=dict(
                                Counter(str(value) for value in values)
                            ),
                            respondentCount=len(values),
                        )
                    )
        return result

    def build_responses(
        self,
        sessions: list[InterviewSession],
        survey_id: str,
        questions: list[SurveyQuestion],
    ) -> list[SurveyResponse]:
        question_map = {question.id: question for question in questions}
        responses: list[SurveyResponse] = []
        for session in sessions:
            answers = {}
            for message in session.dialog:
                if (
                    message.role != "respondent"
                    or not message.questionId
                    or message.answerValue is None
                ):
                    continue
                question = question_map.get(message.questionId)
                if question is None:
                    continue
                value = message.answerValue.value
                if question.type == "text":
                    answers[question.id] = TextAnswer(value=str(value))
                elif question.type == "choice":
                    answers[question.id] = ChoiceAnswer(value=str(value))
                else:
                    answers[question.id] = ScaleAnswer(value=float(value))
            status = (
                "partial"
                if session.status in {"pending", "in_progress"}
                else session.status
            )
            responses.append(
                SurveyResponse(
                    id=f"response-{session.respondentId}",
                    surveyId=survey_id,
                    respondentId=session.respondentId,
                    answers=answers,
                    status=status,
                    startedAt=session.startTime,
                    finishedAt=session.endTime,
                )
            )
        return responses

    @staticmethod
    def _dimension_value(
        respondent: RespondentProfile,
        configs: list[RespondentConfig],
        key: str,
    ) -> str:
        config = next(
            (item for item in configs if item.id == respondent.configId),
            None,
        )
        if key == "ageRange":
            return config.ageRange if config else "Unknown"
        return str(getattr(respondent, key, None) or getattr(config, key, "Unknown"))

    def query(
        self,
        snapshot: RunSnapshot,
        query: AnalyticsQuery,
    ) -> AnalyticsQueryResult:
        configs = snapshot.config.respondentConfigs
        metadata = []
        for key, label in DIMENSION_LABELS.items():
            values = list(
                dict.fromkeys(
                    self._dimension_value(item, configs, key)
                    for item in snapshot.respondents
                )
            )
            metadata.append(DimensionMetadata(key=key, label=label, values=values))
        filtered = [
            respondent
            for respondent in snapshot.respondents
            if all(
                self._dimension_value(respondent, configs, key) == value
                for key, value in query.filters.items()
                if value
            )
        ]
        ids = {item.id for item in filtered}
        sessions = [
            session
            for session in snapshot.sessions
            if session.respondentId in ids
        ]
        selected = next(
            (
                item
                for item in self.analyze_questions(
                    sessions,
                    snapshot.config.questions,
                )
                if item.questionId == query.questionId
            ),
            None,
        )
        buckets: dict[tuple[str, ...], list[RespondentProfile]] = {}
        for respondent in filtered:
            key = tuple(
                self._dimension_value(respondent, configs, dimension)
                for dimension in query.groupBy
            )
            if key:
                buckets.setdefault(key, []).append(respondent)
        grouped = []
        for values, members in buckets.items():
            member_ids = {item.id for item in members}
            member_sessions = [
                session
                for session in sessions
                if session.respondentId in member_ids
            ]
            analysis = next(
                (
                    item
                    for item in self.analyze_questions(
                        member_sessions,
                        snapshot.config.questions,
                    )
                    if item.questionId == query.questionId
                ),
                None,
            )
            label = " / ".join(
                f"{DIMENSION_LABELS[dimension]}: {value}"
                for dimension, value in zip(query.groupBy, values, strict=True)
            )
            grouped.append(
                GroupedQuestionSummary(
                    label=label,
                    respondentCount=len(members),
                    totalResponses=analysis.totalResponses if analysis else 0,
                    analysis=analysis,
                )
            )
        return AnalyticsQueryResult(
            dimensionMetadata=metadata,
            filteredRespondentCount=len(filtered),
            totalRespondentCount=len(snapshot.respondents),
            filteredQuestionAnalysis=selected,
            groupedQuestionSummaries=grouped,
        )
