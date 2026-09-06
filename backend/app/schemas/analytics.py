from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.survey import (
    ApiModel,
    QuestionAnalysis,
    RespondentProfile,
    SessionStatus,
)

DimensionKey = Literal["gender", "ageRange", "occupation", "city", "income"]


class AnalyticsQuery(ApiModel):
    questionId: str
    filters: dict[DimensionKey, str] = Field(default_factory=dict)
    groupBy: list[DimensionKey] = Field(default_factory=list)


class DimensionMetadata(ApiModel):
    key: DimensionKey
    label: str
    values: list[str]


class GroupedQuestionSummary(ApiModel):
    label: str
    respondentCount: int
    validResponseCount: int
    analysis: QuestionAnalysis | None


class AnalysisScope(ApiModel):
    populationCount: int
    filteredRespondentCount: int
    validResponseCount: int
    excludedResponseCount: int
    filters: dict[DimensionKey, str]
    groupBy: list[DimensionKey]
    label: str
    smallSample: bool


class AnalyticsQueryResult(ApiModel):
    dimensionMetadata: list[DimensionMetadata]
    scope: AnalysisScope
    filteredQuestionAnalysis: QuestionAnalysis | None
    groupedQuestionSummaries: list[GroupedQuestionSummary]


class ExceptionRespondent(ApiModel):
    respondentId: str
    profile: RespondentProfile
    completedQuestions: int
    totalQuestions: int
    lastValidAnswer: str | None
    lastValidAnswerAt: datetime | None
    status: SessionStatus
    reason: str
    startedAt: datetime | None
    finishedAt: datetime | None


class ExceptionGroup(ApiModel):
    status: SessionStatus
    code: str
    reason: str
    count: int
    respondents: list[ExceptionRespondent]


class ExceptionReport(ApiModel):
    roundId: str
    totalCount: int
    groups: list[ExceptionGroup]
