from typing import Literal

from pydantic import Field

from app.schemas.survey import ApiModel, QuestionAnalysis

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
    totalResponses: int
    analysis: QuestionAnalysis | None


class AnalyticsQueryResult(ApiModel):
    dimensionMetadata: list[DimensionMetadata]
    filteredRespondentCount: int
    totalRespondentCount: int
    filteredQuestionAnalysis: QuestionAnalysis | None
    groupedQuestionSummaries: list[GroupedQuestionSummary]
