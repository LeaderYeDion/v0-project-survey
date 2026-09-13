from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from app.schemas.analytics import DimensionKey, ExceptionReport
from app.schemas.research import ConfigVersionView
from app.schemas.survey import (
    ApiModel, InferenceEvidence, InferenceKind, InferenceSummaryItem,
    InferenceTaskStatus, InterviewSession, RespondentProfile, RunStatus,
    SimulationMode, SurveyConfig, SurveyProgress, SurveyResponse,
)
from app.locales import Locale


ExportFormat = Literal["json", "csv"]
ExportScope = Literal["full", "filtered", "exceptions"]
ExportStatus = Literal["processing", "succeeded", "failed"]


class ExportRequest(ApiModel):
    format: ExportFormat
    scope: ExportScope
    filename: str = Field(default="", max_length=1000)
    filters: dict[DimensionKey, str] = Field(default_factory=dict)


class ExportRecord(ApiModel):
    id: str
    roundId: str
    requestedByUserId: str
    format: ExportFormat
    scope: ExportScope
    filters: dict[DimensionKey, str]
    filename: str
    status: ExportStatus
    createdAt: datetime
    finishedAt: datetime | None
    errorCode: str | None
    errorMessage: str | None


class ExportModel(ApiModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ExportRoundMetadata(ExportModel):
    id: str
    name: str
    mode: SimulationMode
    locale: Locale
    status: RunStatus
    rowVersion: int
    projectId: str
    questionnaireId: str
    questionnaireVersionId: str
    configVersionId: str
    parentRoundId: str | None
    retryOfRoundId: str | None
    retryKind: Literal["failed", "incomplete"] | None
    createdAt: datetime
    updatedAt: datetime
    startedAt: datetime | None
    finishedAt: datetime | None
    errorCode: str | None
    errorMessage: str | None
    progress: SurveyProgress


class ExportProjectReference(ExportModel):
    id: str


class ExportQuestionnaireReference(ExportModel):
    id: str
    versionId: str


class ExportInferenceResult(ExportModel):
    id: str
    runId: str
    respondentId: str
    taskId: str
    taskName: str
    kind: InferenceKind
    value: str | list[str] | None
    reason: str | None
    evidence: list[InferenceEvidence]
    status: InferenceTaskStatus
    errorCode: str | None
    errorMessage: str | None


class ExportDocument(ExportModel):
    """Versioned JSON export; declaration order is the serialized field order."""

    schemaVersion: Literal[1] = 1
    scope: ExportScope
    filters: dict[DimensionKey, str]
    appliedFilters: dict[DimensionKey, str]
    populationCount: int
    round: ExportRoundMetadata
    project: ExportProjectReference
    questionnaire: ExportQuestionnaireReference
    configVersion: ConfigVersionView
    config: SurveyConfig
    exportedAt: datetime
    totalRespondents: int
    completedInterviews: int
    sessions: list[InterviewSession]
    respondents: list[RespondentProfile]
    responses: list[SurveyResponse]
    exceptions: ExceptionReport
    inferenceResults: list[ExportInferenceResult]
    inferenceSummary: list[InferenceSummaryItem]


@dataclass(frozen=True, slots=True)
class GeneratedExport:
    content: bytes
    media_type: str
    filename: str
    content_disposition: str
    record_id: str
