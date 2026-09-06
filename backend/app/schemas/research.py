from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.survey import SurveyConfig, SurveyQuestion


CURRENT_CONFIG_SCHEMA_VERSION = 1


class ResearchModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class CreateProject(ResearchModel):
    name: str = Field(min_length=1, max_length=255)
    research_goal: str = Field(alias="researchGoal", min_length=1)
    principal_name: str = Field(
        alias="principalName",
        min_length=1,
        max_length=255,
    )


class UpdateProject(ResearchModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    research_goal: str | None = Field(
        default=None,
        alias="researchGoal",
        min_length=1,
    )
    principal_name: str | None = Field(
        default=None,
        alias="principalName",
        min_length=1,
        max_length=255,
    )

    @model_validator(mode="after")
    def require_a_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("project update requires at least one field")
        return self


class ProjectView(ResearchModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    id: UUID
    name: str
    research_goal: str = Field(alias="researchGoal")
    principal_name: str = Field(alias="principalName")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class CreateQuestionnaire(ResearchModel):
    mode: Literal["survey", "interview"]
    config: SurveyConfig
    schema_version: int = Field(
        default=CURRENT_CONFIG_SCHEMA_VERSION,
        alias="schemaVersion",
        gt=0,
    )


class SaveDraft(ResearchModel):
    config: SurveyConfig
    expected_revision: int = Field(alias="expectedRevision", ge=0)


class QuestionnaireView(ResearchModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    id: UUID
    project_id: UUID = Field(alias="projectId")
    mode: Literal["survey", "interview"]
    title: str
    description: str
    config: SurveyConfig
    schema_version: int = Field(alias="schemaVersion")
    draft_revision: int = Field(alias="draftRevision")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class QuestionnaireVersionView(ResearchModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    id: UUID
    questionnaire_id: UUID = Field(alias="questionnaireId")
    version_number: int = Field(alias="versionNumber")
    schema_version: int = Field(alias="schemaVersion")
    questions: list[SurveyQuestion]
    content_hash: str = Field(alias="contentHash")
    created_at: datetime = Field(alias="createdAt")


class ConfigVersionView(ResearchModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    id: UUID
    project_id: UUID = Field(alias="projectId")
    questionnaire_version_id: UUID = Field(alias="questionnaireVersionId")
    version_number: int = Field(alias="versionNumber")
    schema_version: int = Field(alias="schemaVersion")
    full_snapshot: SurveyConfig = Field(alias="fullSnapshot")
    content_hash: str = Field(alias="contentHash")
    created_at: datetime = Field(alias="createdAt")


class FrozenConfig(ResearchModel):
    model_config = ConfigDict(frozen=True, populate_by_name=True)

    questionnaire_version_id: UUID = Field(alias="questionnaireVersionId")
    config_version_id: UUID = Field(alias="configVersionId")
    config: SurveyConfig
