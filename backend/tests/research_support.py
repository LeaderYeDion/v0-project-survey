from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

from app.db.models import (
    ConfigVersionRow,
    ProjectRow,
    QuestionnaireRow,
    QuestionnaireVersionRow,
)
from app.repositories.protocols import FrozenVersionRows, VersionFreezePayload
from app.security.passwords import hash_password


def valid_config(*, title: str = "Original survey") -> dict:
    return {
        "title": title,
        "description": "A stable research instrument",
        "questions": [
            {
                "id": "q1",
                "type": "choice",
                "question": "Choose one",
                "options": ["A", "B"],
            }
        ],
        "maxResponseTime": 90,
        "respondentConfigs": [
            {
                "id": "group-1",
                "gender": "all",
                "ageRange": "18-65",
                "occupation": "all",
                "city": "Hangzhou",
                "income": "all",
                "count": 2,
            }
        ],
        "inferenceConfig": None,
    }


class FakeResearchRepository:
    def __init__(self) -> None:
        self.projects: dict[UUID, ProjectRow] = {}
        self.questionnaires: dict[UUID, QuestionnaireRow] = {}
        self.questionnaire_versions: dict[UUID, QuestionnaireVersionRow] = {}
        self.config_versions: dict[UUID, ConfigVersionRow] = {}

    async def create_project(self, owner_id: UUID, payload) -> ProjectRow:
        now = datetime.now(UTC)
        row = ProjectRow(
            id=uuid4(),
            owner_user_id=owner_id,
            name=payload["name"],
            research_goal=payload["research_goal"],
            principal_name=payload["principal_name"],
            created_at=now,
            updated_at=now,
            archived_at=None,
        )
        self.projects[row.id] = row
        return row

    async def list_projects(self, owner_id: UUID):
        return sorted(
            (
                row
                for row in self.projects.values()
                if row.owner_user_id == owner_id
            ),
            key=lambda row: (row.updated_at, row.id),
            reverse=True,
        )

    async def get_project_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> ProjectRow | None:
        row = self.projects.get(project_id)
        return row if row is not None and row.owner_user_id == owner_id else None

    async def update_project(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload,
    ) -> ProjectRow | None:
        row = await self.get_project_for_owner(owner_id, project_id)
        if row is None:
            return None
        for key, value in payload.items():
            setattr(row, key, value)
        row.updated_at = datetime.now(UTC) + timedelta(microseconds=1)
        return row

    async def create_questionnaire(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload,
    ) -> QuestionnaireRow | None:
        if await self.get_project_for_owner(owner_id, project_id) is None:
            return None
        now = datetime.now(UTC)
        row = QuestionnaireRow(
            id=uuid4(),
            project_id=project_id,
            mode=payload["mode"],
            title=payload["title"],
            description=payload["description"],
            draft_config=deepcopy(payload["draft_config"]),
            draft_schema_version=payload["draft_schema_version"],
            draft_revision=1,
            created_at=now,
            updated_at=now,
            archived_at=None,
        )
        self.questionnaires[row.id] = row
        return row

    async def get_questionnaire_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> QuestionnaireRow | None:
        row = self.questionnaires.get(questionnaire_id)
        if row is None:
            return None
        project = self.projects.get(row.project_id)
        return (
            row
            if project is not None and project.owner_user_id == owner_id
            else None
        )

    async def list_questionnaires_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ):
        if await self.get_project_for_owner(owner_id, project_id) is None:
            return []
        return sorted(
            (
                row
                for row in self.questionnaires.values()
                if row.project_id == project_id
            ),
            key=lambda row: (row.updated_at, row.id),
            reverse=True,
        )

    async def save_draft(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        config,
        expected_revision: int,
    ) -> QuestionnaireRow | None:
        row = await self.get_questionnaire_for_owner(owner_id, questionnaire_id)
        if row is None or row.draft_revision != expected_revision:
            return None
        row.draft_config = deepcopy(dict(config))
        row.title = config["title"]
        row.description = config["description"]
        row.draft_revision += 1
        row.updated_at = datetime.now(UTC) + timedelta(microseconds=1)
        return row

    async def get_config_version_for_owner(
        self,
        owner_id: UUID,
        config_version_id: UUID,
    ) -> ConfigVersionRow | None:
        row = self.config_versions.get(config_version_id)
        if row is None:
            return None
        project = self.projects.get(row.project_id)
        return (
            row
            if project is not None and project.owner_user_id == owner_id
            else None
        )

    async def freeze_versions(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        payload: VersionFreezePayload,
    ) -> FrozenVersionRows | None:
        questionnaire = await self.get_questionnaire_for_owner(
            owner_id,
            questionnaire_id,
        )
        if questionnaire is None:
            return None

        questionnaire_version = next(
            (
                row
                for row in self.questionnaire_versions.values()
                if row.questionnaire_id == questionnaire_id
                and row.schema_version == payload.schema_version
                and row.content_hash == payload.questionnaire_content_hash
            ),
            None,
        )
        if questionnaire_version is None:
            questionnaire_version = QuestionnaireVersionRow(
                id=uuid4(),
                questionnaire_id=questionnaire_id,
                version_number=1
                + max(
                    (
                        row.version_number
                        for row in self.questionnaire_versions.values()
                        if row.questionnaire_id == questionnaire_id
                    ),
                    default=0,
                ),
                schema_version=payload.schema_version,
                questions_json=deepcopy(list(payload.questions_json)),
                content_hash=payload.questionnaire_content_hash,
                created_by_user_id=owner_id,
                created_at=datetime.now(UTC),
            )
            self.questionnaire_versions[questionnaire_version.id] = (
                questionnaire_version
            )

        config_version = next(
            (
                row
                for row in self.config_versions.values()
                if row.project_id == questionnaire.project_id
                and row.questionnaire_version_id == questionnaire_version.id
                and row.schema_version == payload.schema_version
                and row.content_hash == payload.config_content_hash
            ),
            None,
        )
        if config_version is None:
            config_version = ConfigVersionRow(
                id=uuid4(),
                project_id=questionnaire.project_id,
                questionnaire_version_id=questionnaire_version.id,
                version_number=1
                + max(
                    (
                        row.version_number
                        for row in self.config_versions.values()
                        if row.project_id == questionnaire.project_id
                    ),
                    default=0,
                ),
                schema_version=payload.schema_version,
                respondent_plan_json=deepcopy(
                    list(payload.respondent_plan_json)
                ),
                inference_config_json=deepcopy(payload.inference_config_json),
                run_settings_json=deepcopy(dict(payload.run_settings_json)),
                full_snapshot_json=deepcopy(dict(payload.full_snapshot_json)),
                content_hash=payload.config_content_hash,
                created_by_user_id=owner_id,
                created_at=datetime.now(UTC),
            )
            self.config_versions[config_version.id] = config_version

        return FrozenVersionRows(questionnaire_version, config_version)

    async def list_questionnaire_versions_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ):
        if (
            await self.get_questionnaire_for_owner(owner_id, questionnaire_id)
            is None
        ):
            return []
        return sorted(
            (
                row
                for row in self.questionnaire_versions.values()
                if row.questionnaire_id == questionnaire_id
            ),
            key=lambda row: (row.version_number, row.id),
            reverse=True,
        )

    async def list_config_versions_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ):
        if await self.get_project_for_owner(owner_id, project_id) is None:
            return []
        return sorted(
            (
                row
                for row in self.config_versions.values()
                if row.project_id == project_id
            ),
            key=lambda row: (row.version_number, row.id),
            reverse=True,
        )


class FakeAuthRepository:
    def __init__(self) -> None:
        self.users: dict[str, SimpleNamespace] = {}
        self.sessions: dict[str, SimpleNamespace] = {}

    async def add_user(self, username: str) -> SimpleNamespace:
        user = SimpleNamespace(
            id=uuid4(),
            username=username,
            password_hash=hash_password("Research-Password-01!"),
            locale="zh-CN",
            is_active=True,
        )
        self.users[username] = user
        return user

    async def get_user_by_username(self, username: str):
        return self.users.get(username)

    async def get_user(self, user_id: UUID):
        return next(
            (user for user in self.users.values() if user.id == user_id),
            None,
        )

    async def create_session(
        self,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ):
        session = SimpleNamespace(
            id=uuid4(),
            user_id=user_id,
            token_hash=token_hash,
            csrf_token_hash=csrf_token_hash,
            expires_at=expires_at,
            revoked_at=None,
        )
        self.sessions[token_hash] = session
        return session

    async def get_session_by_token_hash(self, token_hash: str):
        return self.sessions.get(token_hash)

    async def revoke_session(self, token_hash: str) -> None:
        session = self.sessions.get(token_hash)
        if session is not None:
            session.revoked_at = datetime.now(UTC)
