from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

from app.db.models import (
    ConfigVersionRow,
    ExportRecordRow,
    InferenceResultRow,
    MessageRow,
    ProjectRow,
    QuestionnaireRow,
    QuestionnaireVersionRow,
    ResearchRoundRow,
    ResponseRow,
    RoundRespondentRow,
    SessionRow,
    UserRow,
    UserSessionRow,
)


RetryKind = Literal["failed", "incomplete"]


@dataclass(frozen=True, slots=True)
class VersionFreezePayload:
    schema_version: int
    expected_draft_revision: int
    expected_draft_content_hash: str
    questions_json: Sequence[Mapping[str, Any]]
    respondent_plan_json: Sequence[Mapping[str, Any]]
    inference_config_json: Mapping[str, Any] | None
    run_settings_json: Mapping[str, Any]
    full_snapshot_json: Mapping[str, Any]
    questionnaire_content_hash: str
    config_content_hash: str


@dataclass(frozen=True, slots=True)
class FrozenVersionRows:
    questionnaire_version: QuestionnaireVersionRow
    config_version: ConfigVersionRow


@dataclass(frozen=True, slots=True)
class RoundCheckpoint:
    status: str
    active_respondent_id: UUID | None
    total_respondents: int
    completed_respondents: int
    terminated_respondents: int
    failed_respondents: int
    incomplete_respondents: int
    pause_requested_at: datetime | None
    lease_owner: str | None
    lease_expires_at: datetime | None
    respondent: RoundRespondentRow
    session: SessionRow
    messages: Sequence[MessageRow] = ()
    responses: Sequence[ResponseRow] = ()
    inference_results: Sequence[InferenceResultRow] = ()
    error_code: str | None = None
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class RoundResultRows:
    round: ResearchRoundRow
    respondents: Sequence[RoundRespondentRow]
    sessions: Sequence[SessionRow]
    messages: Sequence[MessageRow]
    responses: Sequence[ResponseRow]
    inference_results: Sequence[InferenceResultRow]


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

    async def update_password_hash(
        self,
        username: str,
        password_hash: str,
    ) -> bool: ...


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

    async def update_project(
        self,
        owner_id: UUID,
        project_id: UUID,
        payload: Mapping[str, Any],
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

    async def list_questionnaires_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> Sequence[QuestionnaireRow]: ...

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

    async def freeze_versions(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
        payload: VersionFreezePayload,
    ) -> FrozenVersionRows | None: ...

    async def list_questionnaire_versions_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID,
    ) -> Sequence[QuestionnaireVersionRow]: ...

    async def list_config_versions_for_owner(
        self,
        owner_id: UUID,
        project_id: UUID,
    ) -> Sequence[ConfigVersionRow]: ...


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

    async def acquire_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        lease_expires_at: datetime,
        expected_version: int,
    ) -> ResearchRoundRow | None: ...

    async def release_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        expected_version: int,
    ) -> ResearchRoundRow | None: ...

    async def checkpoint(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        checkpoint: RoundCheckpoint,
    ) -> ResearchRoundRow | None: ...

    async def get_result_rows_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> RoundResultRows | None: ...

    async def list_retryable_respondents_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
        retry_kind: RetryKind,
    ) -> Sequence[RoundRespondentRow]: ...

    async def reconcile_interrupted_rounds(
        self,
        stale_before: datetime,
    ) -> Sequence[ResearchRoundRow]: ...

    async def get_owner_id(self, round_id: UUID) -> UUID | None: ...


class ExportRepositoryProtocol(Protocol):
    async def fail_stale_processing(
        self, stale_before: datetime, finished_at: datetime,
    ) -> Sequence[ExportRecordRow]: ...

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
