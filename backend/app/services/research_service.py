from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any
from uuid import UUID

from app.api.errors import ApiError
from app.repositories.protocols import (
    ResearchRepositoryProtocol,
    VersionFreezePayload,
)
from app.schemas.research import (
    CURRENT_CONFIG_SCHEMA_VERSION,
    ConfigVersionView,
    CreateProject,
    CreateQuestionnaire,
    FrozenConfig,
    ProjectView,
    QuestionnaireVersionView,
    QuestionnaireView,
    UpdateProject,
)
from app.schemas.survey import SurveyConfig


class ResearchService:
    def __init__(self, repository: ResearchRepositoryProtocol) -> None:
        self._repository = repository

    async def create_project(
        self,
        owner_id: UUID,
        payload: CreateProject,
    ) -> ProjectView:
        row = await self._repository.create_project(
            owner_id,
            payload.model_dump(),
        )
        return _project_view(row)

    async def list_projects(self, owner_id: UUID) -> list[ProjectView]:
        return [
            _project_view(row)
            for row in await self._repository.list_projects(owner_id)
        ]

    async def get_project(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> ProjectView:
        row = await self._repository.get_project_for_owner(owner_id, project_id)
        if row is None:
            raise _not_found()
        return _project_view(row)

    async def update_project(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: UpdateProject,
    ) -> ProjectView:
        row = await self._repository.update_project(
            owner_id,
            project_id,
            payload.model_dump(exclude_unset=True),
        )
        if row is None:
            raise _not_found()
        return _project_view(row)

    async def create_questionnaire(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: CreateQuestionnaire,
    ) -> QuestionnaireView:
        _require_supported_schema(payload.schema_version)
        config = payload.config.model_dump(mode="json")
        row = await self._repository.create_questionnaire(
            owner_id,
            project_id,
            {
                "mode": payload.mode,
                "title": payload.config.title,
                "description": payload.config.description,
                "draft_config": config,
                "draft_schema_version": payload.schema_version,
                "draft_revision": 1,
            },
        )
        if row is None:
            raise _not_found()
        return _questionnaire_view(row)

    async def get_questionnaire(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> QuestionnaireView:
        row = await self._owned_questionnaire(owner_id, questionnaire_id)
        return _questionnaire_view(row)

    async def list_questionnaires(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> list[QuestionnaireView]:
        if (
            await self._repository.get_project_for_owner(owner_id, project_id)
            is None
        ):
            raise _not_found()
        return [
            _questionnaire_view(row)
            for row in await self._repository.list_questionnaires_for_owner(
                owner_id,
                project_id,
            )
        ]

    async def save_draft(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        config: SurveyConfig,
        expected_revision: int,
    ) -> QuestionnaireView:
        questionnaire = await self._owned_questionnaire(
            owner_id,
            questionnaire_id,
        )
        _require_supported_schema(questionnaire.draft_schema_version)
        row = await self._repository.save_draft(
            owner_id,
            questionnaire_id,
            config.model_dump(mode="json"),
            expected_revision,
        )
        if row is None:
            raise ApiError(
                409,
                "DRAFT_CONFLICT",
                "The questionnaire draft has changed",
            )
        return _questionnaire_view(row)

    async def freeze_config(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> FrozenConfig:
        questionnaire = await self._owned_questionnaire(
            owner_id,
            questionnaire_id,
        )
        _require_supported_schema(questionnaire.draft_schema_version)
        config = SurveyConfig.model_validate(questionnaire.draft_config)
        snapshot = config.model_dump(mode="json")
        questions = [question.model_dump(mode="json") for question in config.questions]
        payload = VersionFreezePayload(
            schema_version=questionnaire.draft_schema_version,
            expected_draft_revision=questionnaire.draft_revision,
            expected_draft_content_hash=_content_hash(snapshot),
            questions_json=questions,
            respondent_plan_json=[
                respondent.model_dump(mode="json")
                for respondent in config.respondentConfigs
            ],
            inference_config_json=(
                config.inferenceConfig.model_dump(mode="json")
                if config.inferenceConfig is not None
                else None
            ),
            run_settings_json={"maxResponseTime": config.maxResponseTime},
            full_snapshot_json=snapshot,
            questionnaire_content_hash=_content_hash(questions),
            config_content_hash=_content_hash(snapshot),
        )
        rows = await self._repository.freeze_versions(
            owner_id,
            questionnaire_id,
            payload,
        )
        if rows is None:
            if (
                await self._repository.get_questionnaire_for_owner(
                    owner_id,
                    questionnaire_id,
                )
                is None
            ):
                raise _not_found()
            raise ApiError(
                409,
                "DRAFT_CONFLICT",
                "The questionnaire draft changed while it was frozen",
            )
        return FrozenConfig(
            questionnaireVersionId=rows.questionnaire_version.id,
            configVersionId=rows.config_version.id,
            config=config,
        )

    async def get_config_version(
        self,
        owner_id: UUID,
        config_version_id: UUID,
    ) -> ConfigVersionView:
        row = await self._repository.get_config_version_for_owner(
            owner_id,
            config_version_id,
        )
        if row is None:
            raise _not_found()
        _require_supported_schema(row.schema_version)
        return _config_version_view(row)

    async def list_questionnaire_versions(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> list[QuestionnaireVersionView]:
        await self._owned_questionnaire(owner_id, questionnaire_id)
        rows = await self._repository.list_questionnaire_versions_for_owner(
            owner_id,
            questionnaire_id,
        )
        for row in rows:
            _require_supported_schema(row.schema_version)
        return [_questionnaire_version_view(row) for row in rows]

    async def _owned_questionnaire(self, owner_id: UUID, questionnaire_id: UUID):
        row = await self._repository.get_questionnaire_for_owner(
            owner_id,
            questionnaire_id,
        )
        if row is None:
            raise _not_found()
        return row


def _project_view(row) -> ProjectView:
    return ProjectView(
        id=row.id,
        name=row.name,
        researchGoal=row.research_goal,
        principalName=row.principal_name,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _questionnaire_view(row) -> QuestionnaireView:
    _require_supported_schema(row.draft_schema_version)
    return QuestionnaireView(
        id=row.id,
        projectId=row.project_id,
        mode=row.mode,
        title=row.title,
        description=row.description,
        config=SurveyConfig.model_validate(row.draft_config),
        schemaVersion=row.draft_schema_version,
        draftRevision=row.draft_revision,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _questionnaire_version_view(row) -> QuestionnaireVersionView:
    return QuestionnaireVersionView(
        id=row.id,
        questionnaireId=row.questionnaire_id,
        versionNumber=row.version_number,
        schemaVersion=row.schema_version,
        questions=row.questions_json,
        contentHash=row.content_hash,
        createdAt=row.created_at,
    )


def _config_version_view(row) -> ConfigVersionView:
    return ConfigVersionView(
        id=row.id,
        projectId=row.project_id,
        questionnaireVersionId=row.questionnaire_version_id,
        versionNumber=row.version_number,
        schemaVersion=row.schema_version,
        fullSnapshot=SurveyConfig.model_validate(row.full_snapshot_json),
        contentHash=row.content_hash,
        createdAt=row.created_at,
    )


def _content_hash(value: Mapping[str, Any] | list[dict[str, Any]]) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _require_supported_schema(schema_version: int) -> None:
    if schema_version != CURRENT_CONFIG_SCHEMA_VERSION:
        raise ApiError(
            422,
            "CONFIG_VERSION_UNSUPPORTED",
            f"Config schema version {schema_version} is not supported",
        )


def _not_found() -> ApiError:
    return ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
    )
