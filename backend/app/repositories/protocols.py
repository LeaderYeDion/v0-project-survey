from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from app.db.models import (
    ConfigVersionRow,
    ExportRecordRow,
    ProjectRow,
    QuestionnaireRow,
    ResearchRoundRow,
    UserRow,
    UserSessionRow,
)


class AuthRepositoryProtocol(Protocol):
    async def create_user(
        self,
        username: str,
        password_hash: str,
        locale: str,
    ) -> UserRow: ...

    async def get_user_by_username(self, username: str) -> UserRow | None: ...

    async def get_user(self, user_id: UUID) -> UserRow | None: ...

    async def create_session(
        self,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ) -> UserSessionRow: ...

    async def get_session_by_token_hash(
        self,
        token_hash: str,
    ) -> UserSessionRow | None: ...

    async def revoke_session(self, token_hash: str) -> None: ...


class ResearchRepositoryProtocol(Protocol):
    async def create_project(
        self,
        owner_id: UUID,
        payload: Mapping[str, Any],
    ) -> ProjectRow: ...

    async def list_projects(self, owner_id: UUID) -> Sequence[ProjectRow]: ...

    async def get_project_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> ProjectRow | None: ...

    async def create_questionnaire(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: Mapping[str, Any],
    ) -> QuestionnaireRow | None: ...

    async def get_questionnaire_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> QuestionnaireRow | None: ...

    async def save_draft(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        config: Mapping[str, Any],
        expected_revision: int,
    ) -> QuestionnaireRow | None: ...

    async def get_config_version_for_owner(
        self,
        owner_id: UUID,
        config_version_id: UUID,
    ) -> ConfigVersionRow | None: ...


class RoundRepositoryProtocol(Protocol):
    async def create_round(
        self,
        owner_id: UUID,
        payload: Mapping[str, Any],
    ) -> ResearchRoundRow: ...

    async def get_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> ResearchRoundRow | None: ...

    async def list_rounds_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID | None = None,
    ) -> Sequence[ResearchRoundRow]: ...

    async def transition(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        from_statuses: frozenset[str],
        to_status: str,
    ) -> ResearchRoundRow | None: ...


class ExportRepositoryProtocol(Protocol):
    async def create_export(
        self,
        owner_id: UUID,
        round_id: UUID,
        payload: Mapping[str, Any],
    ) -> ExportRecordRow | None: ...

    async def list_exports_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> Sequence[ExportRecordRow]: ...

    async def mark_succeeded(
        self,
        owner_id: UUID,
        export_id: UUID,
        filename: str,
        finished_at: datetime,
    ) -> ExportRecordRow | None: ...

    async def mark_failed(
        self,
        owner_id: UUID,
        export_id: UUID,
        error_code: str,
        error_message: str,
        finished_at: datetime,
    ) -> ExportRecordRow | None: ...


class RepositoryProtocol(
    AuthRepositoryProtocol,
    ResearchRepositoryProtocol,
    RoundRepositoryProtocol,
    ExportRepositoryProtocol,
    Protocol,
):
    """Combined persistence boundary for services spanning P0 domains."""
