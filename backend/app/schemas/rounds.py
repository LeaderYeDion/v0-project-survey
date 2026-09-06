from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.survey import RunSnapshot


RetryKind = Literal["failed", "incomplete"]


class RetryRoundRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: RetryKind


class RoundSnapshot(RunSnapshot):
    name: str
    projectId: str
    questionnaireId: str
    questionnaireVersionId: str
    configVersionId: str
    rowVersion: int
    retryOfRoundId: str | None = None
    retryKind: RetryKind | None = None
