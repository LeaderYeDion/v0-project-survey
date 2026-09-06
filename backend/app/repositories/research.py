from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import (
    ConfigVersionRow,
    ProjectRow,
    QuestionnaireRow,
    QuestionnaireVersionRow,
)
from app.repositories.protocols import FrozenVersionRows, VersionFreezePayload


class ResearchRepository:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self._session_factory = session_factory

    async def create_project(
        self,
        owner_id: UUID,
        payload: Mapping[str, Any],
    ) -> ProjectRow:
        row = ProjectRow(owner_user_id=owner_id, **payload)
        async with self._session_factory() as session:
            async with session.begin():
                session.add(row)
                await session.flush()
        return row

    async def list_projects(self, owner_id: UUID) -> Sequence[ProjectRow]:
        statement = (
            select(ProjectRow)
            .where(ProjectRow.owner_user_id == owner_id)
            .order_by(desc(ProjectRow.updated_at), ProjectRow.id)
        )
        async with self._session_factory() as session:
            return tuple((await session.scalars(statement)).all())

    async def get_project_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> ProjectRow | None:
        statement = select(ProjectRow).where(
            ProjectRow.id == project_id,
            ProjectRow.owner_user_id == owner_id,
        )
        async with self._session_factory() as session:
            return await session.scalar(statement)

    async def update_project(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: Mapping[str, Any],
    ) -> ProjectRow | None:
        statement = (
            update(ProjectRow)
            .where(
                ProjectRow.id == project_id,
                ProjectRow.owner_user_id == owner_id,
            )
            .values(**payload, updated_at=datetime.now(UTC))
            .returning(ProjectRow)
        )
        async with self._session_factory() as session:
            async with session.begin():
                return await session.scalar(statement)

    async def create_questionnaire(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: Mapping[str, Any],
    ) -> QuestionnaireRow | None:
        project_statement = select(ProjectRow.id).where(
            ProjectRow.id == project_id,
            ProjectRow.owner_user_id == owner_id,
        )
        async with self._session_factory() as session:
            async with session.begin():
                if await session.scalar(project_statement) is None:
                    return None
                row = QuestionnaireRow(project_id=project_id, **payload)
                session.add(row)
                await session.flush()
                return row

    async def get_questionnaire_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> QuestionnaireRow | None:
        statement = (
            select(QuestionnaireRow)
            .join(ProjectRow, ProjectRow.id == QuestionnaireRow.project_id)
            .where(
                QuestionnaireRow.id == questionnaire_id,
                ProjectRow.owner_user_id == owner_id,
            )
        )
        async with self._session_factory() as session:
            return await session.scalar(statement)

    async def list_questionnaires_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> Sequence[QuestionnaireRow]:
        statement = (
            select(QuestionnaireRow)
            .join(ProjectRow, ProjectRow.id == QuestionnaireRow.project_id)
            .where(
                QuestionnaireRow.project_id == project_id,
                ProjectRow.owner_user_id == owner_id,
            )
            .order_by(desc(QuestionnaireRow.updated_at), QuestionnaireRow.id)
        )
        async with self._session_factory() as session:
            return tuple((await session.scalars(statement)).all())

    async def save_draft(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        config: Mapping[str, Any],
        expected_revision: int,
    ) -> QuestionnaireRow | None:
        owned_projects = select(ProjectRow.id).where(
            ProjectRow.owner_user_id == owner_id
        )
        statement = (
            update(QuestionnaireRow)
            .where(
                QuestionnaireRow.id == questionnaire_id,
                QuestionnaireRow.project_id.in_(owned_projects),
                QuestionnaireRow.draft_revision == expected_revision,
            )
            .values(
                title=config["title"],
                description=config["description"],
                draft_config=dict(config),
                draft_revision=QuestionnaireRow.draft_revision + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(QuestionnaireRow)
        )
        async with self._session_factory() as session:
            async with session.begin():
                return await session.scalar(statement)

    async def get_config_version_for_owner(
        self,
        owner_id: UUID,
        config_version_id: UUID,
    ) -> ConfigVersionRow | None:
        statement = (
            select(ConfigVersionRow)
            .join(ProjectRow, ProjectRow.id == ConfigVersionRow.project_id)
            .where(
                ConfigVersionRow.id == config_version_id,
                ProjectRow.owner_user_id == owner_id,
            )
        )
        async with self._session_factory() as session:
            return await session.scalar(statement)

    async def freeze_versions(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        payload: VersionFreezePayload,
    ) -> FrozenVersionRows | None:
        async with self._session_factory() as session:
            async with session.begin():
                questionnaire = await session.scalar(
                    select(QuestionnaireRow)
                    .join(
                        ProjectRow,
                        ProjectRow.id == QuestionnaireRow.project_id,
                    )
                    .where(
                        QuestionnaireRow.id == questionnaire_id,
                        ProjectRow.owner_user_id == owner_id,
                    )
                    .with_for_update()
                )
                if questionnaire is None:
                    return None

                project = await session.scalar(
                    select(ProjectRow)
                    .where(
                        ProjectRow.id == questionnaire.project_id,
                        ProjectRow.owner_user_id == owner_id,
                    )
                    .with_for_update()
                )
                if project is None:
                    return None

                questionnaire_version = await session.scalar(
                    select(QuestionnaireVersionRow).where(
                        QuestionnaireVersionRow.questionnaire_id
                        == questionnaire_id,
                        QuestionnaireVersionRow.schema_version
                        == payload.schema_version,
                        QuestionnaireVersionRow.content_hash
                        == payload.questionnaire_content_hash,
                    )
                )
                if questionnaire_version is None:
                    next_number = 1 + (
                        await session.scalar(
                            select(
                                func.max(
                                    QuestionnaireVersionRow.version_number
                                )
                            ).where(
                                QuestionnaireVersionRow.questionnaire_id
                                == questionnaire_id
                            )
                        )
                        or 0
                    )
                    questionnaire_version = QuestionnaireVersionRow(
                        questionnaire_id=questionnaire_id,
                        version_number=next_number,
                        schema_version=payload.schema_version,
                        questions_json=[
                            dict(question) for question in payload.questions_json
                        ],
                        content_hash=payload.questionnaire_content_hash,
                        created_by_user_id=owner_id,
                    )
                    session.add(questionnaire_version)
                    await session.flush()

                config_version = await session.scalar(
                    select(ConfigVersionRow).where(
                        ConfigVersionRow.project_id == project.id,
                        ConfigVersionRow.questionnaire_version_id
                        == questionnaire_version.id,
                        ConfigVersionRow.schema_version
                        == payload.schema_version,
                        ConfigVersionRow.content_hash
                        == payload.config_content_hash,
                    )
                )
                if config_version is None:
                    next_number = 1 + (
                        await session.scalar(
                            select(func.max(ConfigVersionRow.version_number)).where(
                                ConfigVersionRow.project_id == project.id
                            )
                        )
                        or 0
                    )
                    config_version = ConfigVersionRow(
                        project_id=project.id,
                        questionnaire_version_id=questionnaire_version.id,
                        version_number=next_number,
                        schema_version=payload.schema_version,
                        respondent_plan_json=[
                            dict(plan) for plan in payload.respondent_plan_json
                        ],
                        inference_config_json=(
                            dict(payload.inference_config_json)
                            if payload.inference_config_json is not None
                            else None
                        ),
                        run_settings_json=dict(payload.run_settings_json),
                        full_snapshot_json=dict(payload.full_snapshot_json),
                        content_hash=payload.config_content_hash,
                        created_by_user_id=owner_id,
                    )
                    session.add(config_version)
                    await session.flush()

                return FrozenVersionRows(
                    questionnaire_version=questionnaire_version,
                    config_version=config_version,
                )

    async def list_questionnaire_versions_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> Sequence[QuestionnaireVersionRow]:
        statement = (
            select(QuestionnaireVersionRow)
            .join(
                QuestionnaireRow,
                QuestionnaireRow.id
                == QuestionnaireVersionRow.questionnaire_id,
            )
            .join(ProjectRow, ProjectRow.id == QuestionnaireRow.project_id)
            .where(
                QuestionnaireVersionRow.questionnaire_id == questionnaire_id,
                ProjectRow.owner_user_id == owner_id,
            )
            .order_by(
                desc(QuestionnaireVersionRow.version_number),
                QuestionnaireVersionRow.id,
            )
        )
        async with self._session_factory() as session:
            return tuple((await session.scalars(statement)).all())

    async def list_config_versions_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> Sequence[ConfigVersionRow]:
        statement = (
            select(ConfigVersionRow)
            .join(ProjectRow, ProjectRow.id == ConfigVersionRow.project_id)
            .where(
                ConfigVersionRow.project_id == project_id,
                ProjectRow.owner_user_id == owner_id,
            )
            .order_by(
                desc(ConfigVersionRow.version_number),
                ConfigVersionRow.id,
            )
        )
        async with self._session_factory() as session:
            return tuple((await session.scalars(statement)).all())
