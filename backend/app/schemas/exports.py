from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.analytics import DimensionKey
from app.schemas.survey import ApiModel


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


@dataclass(frozen=True, slots=True)
class GeneratedExport:
    content: bytes
    media_type: str
    filename: str
    content_disposition: str
    record_id: str
