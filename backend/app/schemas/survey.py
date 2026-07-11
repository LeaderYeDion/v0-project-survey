from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.locales import Locale

QuestionType = Literal["text", "choice", "scale"]
SimulationMode = Literal["interview", "survey"]
Sentiment = Literal["positive", "neutral", "negative"]
SessionStatus = Literal[
    "pending",
    "in_progress",
    "completed",
    "terminated_by_respondent",
    "terminated_by_interviewer",
]
ResponseStatus = Literal[
    "completed",
    "partial",
    "terminated_by_respondent",
    "terminated_by_interviewer",
]
RunStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
InferenceKind = Literal["profile", "attitude"]
InferenceTaskStatus = Literal["completed", "skipped", "failed"]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ScaleRange(ApiModel):
    min: int
    max: int

    @model_validator(mode="after")
    def validate_range(self) -> ScaleRange:
        if self.min >= self.max:
            raise ValueError("scale.min must be less than scale.max")
        return self


class SurveyQuestion(ApiModel):
    id: str = Field(min_length=1)
    type: QuestionType
    question: str
    options: list[str] | None = None
    scale: ScaleRange | None = None

    @model_validator(mode="after")
    def validate_type_fields(self) -> SurveyQuestion:
        if self.type == "choice" and not self.options:
            raise ValueError("choice question requires options")
        if self.type == "scale" and self.scale is None:
            raise ValueError("scale question requires scale")
        return self


class RespondentConfig(ApiModel):
    id: str
    gender: str
    ageRange: str
    occupation: str
    city: str
    income: str
    count: Annotated[int, Field(gt=0)]


class ProfileInferenceTask(ApiModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    options: list[str]
    multiple: bool = False
    enabled: bool = True

    @model_validator(mode="after")
    def validate_options(self) -> ProfileInferenceTask:
        if not self.options:
            raise ValueError("profile inference task requires options")
        return self


class AttitudeInferenceTask(ApiModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    options: list[str] = Field(
        default_factory=lambda: ["积极", "中立", "消极"],
    )
    enabled: bool = True

    @model_validator(mode="after")
    def validate_options(self) -> AttitudeInferenceTask:
        if not self.options:
            raise ValueError("attitude inference task requires options")
        return self


class InferenceConfig(ApiModel):
    enabled: bool = False
    profileEnabled: bool = False
    attitudeEnabled: bool = False
    profileTasks: list[ProfileInferenceTask] = Field(default_factory=list)
    attitudeTasks: list[AttitudeInferenceTask] = Field(default_factory=list)


class SurveyConfig(ApiModel):
    title: str
    description: str
    questions: list[SurveyQuestion]
    maxResponseTime: Annotated[int, Field(gt=0)]
    respondentConfigs: list[RespondentConfig]
    inferenceConfig: InferenceConfig | None = None

    @model_validator(mode="after")
    def validate_non_empty(self) -> SurveyConfig:
        if not self.questions:
            raise ValueError("survey requires at least one question")
        if not self.respondentConfigs:
            raise ValueError("survey requires respondent configs")
        return self


class RespondentProfile(ApiModel):
    id: str
    name: str
    nickname: str
    avatar: str
    age: int
    gender: str
    occupation: str
    city: str
    income: str
    education: str
    maritalStatus: str
    tags: list[str]
    configId: str


class TextAnswer(ApiModel):
    type: Literal["text"] = "text"
    value: str


class ChoiceAnswer(ApiModel):
    type: Literal["choice"] = "choice"
    value: str


class ScaleAnswer(ApiModel):
    type: Literal["scale"] = "scale"
    value: int | float


AnswerValue = Annotated[
    TextAnswer | ChoiceAnswer | ScaleAnswer,
    Field(discriminator="type"),
]


class DialogMessage(ApiModel):
    id: str
    role: Literal["interviewer", "respondent"]
    content: str
    timestamp: datetime
    questionId: str | None = None
    sentiment: Sentiment | None = None
    answerValue: AnswerValue | None = None


class InterviewSession(ApiModel):
    respondentId: str
    status: SessionStatus
    terminationReason: str | None = None
    dialog: list[DialogMessage] = Field(default_factory=list)
    completedQuestions: int
    totalQuestions: int
    startTime: datetime | None = None
    endTime: datetime | None = None


class SurveyResponse(ApiModel):
    id: str
    surveyId: str
    respondentId: str
    answers: dict[str, AnswerValue]
    status: ResponseStatus
    startedAt: datetime | None = None
    finishedAt: datetime | None = None


class SurveyProgress(ApiModel):
    totalRespondents: int
    completedRespondents: int
    inProgressRespondents: int
    terminatedRespondents: int
    currentRespondentIndex: int


class SentimentData(ApiModel):
    positive: int
    neutral: int
    negative: int


class QuestionAnalysis(ApiModel):
    questionId: str
    questionText: str
    questionType: QuestionType
    totalResponses: int
    responseDistribution: dict[str, int]
    averageScore: float | None = None


class DemographicAnalysis(ApiModel):
    tagName: str
    questionId: str
    questionText: str
    responseDistribution: dict[str, int]
    respondentCount: int


class InferenceEvidence(ApiModel):
    questionId: str | None = None
    messageId: str | None = None
    excerpt: str | None = None


class InferenceResult(ApiModel):
    id: str
    runId: str
    respondentId: str
    taskId: str
    taskName: str
    kind: InferenceKind
    value: str | list[str] | None = None
    reason: str | None = None
    evidence: list[InferenceEvidence] = Field(default_factory=list)
    status: InferenceTaskStatus
    error: str | None = None


class InferenceSummaryItem(ApiModel):
    taskId: str
    taskName: str
    kind: InferenceKind
    total: int
    completed: int
    skipped: int
    failed: int
    distribution: dict[str, int]


class CreateRunRequest(ApiModel):
    mode: SimulationMode
    config: SurveyConfig


class RunSnapshot(ApiModel):
    id: str
    mode: SimulationMode
    locale: Locale
    status: RunStatus
    config: SurveyConfig
    respondents: list[RespondentProfile]
    sessions: list[InterviewSession]
    progress: SurveyProgress
    sentiment: SentimentData
    questionAnalysis: list[QuestionAnalysis]
    demographicAnalysis: list[DemographicAnalysis]
    inferenceResults: list[InferenceResult] = Field(default_factory=list)
    inferenceSummary: list[InferenceSummaryItem] = Field(default_factory=list)
    responses: list[SurveyResponse]
    activeRespondentId: str | None
    createdAt: datetime
    startedAt: datetime | None
    finishedAt: datetime | None
    error: str | None

    @classmethod
    def empty(
        cls,
        run_id: str,
        mode: SimulationMode,
        locale: Locale,
        config: SurveyConfig,
        created_at: datetime,
    ) -> RunSnapshot:
        return cls(
            id=run_id,
            mode=mode,
            locale=locale,
            status="queued",
            config=config,
            respondents=[],
            sessions=[],
            progress=SurveyProgress(
                totalRespondents=0,
                completedRespondents=0,
                inProgressRespondents=0,
                terminatedRespondents=0,
                currentRespondentIndex=0,
            ),
            sentiment=SentimentData(positive=0, neutral=0, negative=0),
            questionAnalysis=[],
            demographicAnalysis=[],
            inferenceResults=[],
            inferenceSummary=[],
            responses=[],
            activeRespondentId=None,
            createdAt=created_at,
            startedAt=None,
            finishedAt=None,
            error=None,
        )


class SurveyHistoryRecord(ApiModel):
    id: str
    runId: str
    mode: SimulationMode
    locale: Locale
    savedAt: datetime
    config: SurveyConfig
    sessions: list[InterviewSession]
    respondents: list[RespondentProfile]
    progress: SurveyProgress
    sentiment: SentimentData
    questionAnalysis: list[QuestionAnalysis]
    demographicAnalysis: list[DemographicAnalysis]
    inferenceResults: list[InferenceResult] = Field(default_factory=list)
    inferenceSummary: list[InferenceSummaryItem] = Field(default_factory=list)
    responses: list[SurveyResponse]


class CreateHistoryRequest(ApiModel):
    runId: str
