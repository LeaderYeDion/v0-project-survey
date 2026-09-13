from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _uuid_pk():
    return mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=func.gen_random_uuid(),
    )


def _created_at():
    return mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
    )


class UserRow(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("username", name="uq_users_username"),
    )

    id: Mapped[UUID] = _uuid_pk()
    username: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(16), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
        onupdate=_utc_now,
    )


class UserSessionRow(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
        Index("ix_user_sessions_user_expires", "user_id", "expires_at"),
        Index("ix_user_sessions_expires_at", "expires_at"),
    )

    id: Mapped[UUID] = _uuid_pk()
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = _created_at()
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class ProjectRow(Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_owner_updated", "owner_user_id", "updated_at"),
    )

    id: Mapped[UUID] = _uuid_pk()
    owner_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    research_goal: Mapped[str] = mapped_column(Text, nullable=False)
    principal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
        onupdate=_utc_now,
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class QuestionnaireRow(Base):
    __tablename__ = "questionnaires"
    __table_args__ = (
        CheckConstraint(
            "mode IN ('survey', 'interview')",
            name="ck_questionnaires_mode",
        ),
        CheckConstraint(
            "draft_revision >= 0",
            name="ck_questionnaires_draft_revision",
        ),
        Index(
            "ix_questionnaires_project_updated",
            "project_id",
            "updated_at",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    draft_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    draft_schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    draft_revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
        onupdate=_utc_now,
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class QuestionnaireVersionRow(Base):
    __tablename__ = "questionnaire_versions"
    __table_args__ = (
        UniqueConstraint(
            "questionnaire_id",
            "version_number",
            name="uq_questionnaire_versions_number",
        ),
        UniqueConstraint(
            "questionnaire_id",
            "schema_version",
            "content_hash",
            name="uq_questionnaire_versions_content",
        ),
        CheckConstraint(
            "version_number > 0",
            name="ck_questionnaire_versions_version_number",
        ),
        CheckConstraint(
            "schema_version > 0",
            name="ck_questionnaire_versions_schema_version",
        ),
        Index(
            "ix_questionnaire_versions_questionnaire_created",
            "questionnaire_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    questionnaire_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("questionnaires.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    questions_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = _created_at()


class ConfigVersionRow(Base):
    __tablename__ = "config_versions"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "version_number",
            name="uq_config_versions_number",
        ),
        UniqueConstraint(
            "project_id",
            "questionnaire_version_id",
            "schema_version",
            "content_hash",
            name="uq_config_versions_content",
        ),
        CheckConstraint(
            "version_number > 0",
            name="ck_config_versions_version_number",
        ),
        CheckConstraint(
            "schema_version > 0",
            name="ck_config_versions_schema_version",
        ),
        Index(
            "ix_config_versions_project_created",
            "project_id",
            "created_at",
        ),
        Index(
            "ix_config_versions_questionnaire_version",
            "questionnaire_version_id",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    questionnaire_version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(
            "questionnaire_versions.id",
            ondelete="RESTRICT",
            name="fk_config_versions_questionnaire_version",
        ),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    respondent_plan_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
    )
    inference_config_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    run_settings_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
    )
    full_snapshot_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = _created_at()


class ResearchRoundRow(Base):
    __tablename__ = "research_rounds"
    __table_args__ = (
        CheckConstraint(
            "mode IN ('survey', 'interview')",
            name="ck_research_rounds_mode",
        ),
        CheckConstraint(
            "status IN ('queued', 'running', 'pausing', 'paused', "
            "'completed', 'completed_with_errors', 'failed', 'cancelled')",
            name="ck_research_rounds_status",
        ),
        CheckConstraint(
            "retry_kind IS NULL OR retry_kind IN ('failed', 'incomplete')",
            name="ck_research_rounds_retry_kind",
        ),
        CheckConstraint(
            "row_version >= 0",
            name="ck_research_rounds_row_version",
        ),
        CheckConstraint(
            "total_respondents >= 0",
            name="ck_research_rounds_total_respondents",
        ),
        CheckConstraint(
            "completed_respondents >= 0",
            name="ck_research_rounds_completed_respondents",
        ),
        CheckConstraint(
            "terminated_respondents >= 0",
            name="ck_research_rounds_terminated_respondents",
        ),
        CheckConstraint(
            "failed_respondents >= 0",
            name="ck_research_rounds_failed_respondents",
        ),
        CheckConstraint(
            "incomplete_respondents >= 0",
            name="ck_research_rounds_incomplete_respondents",
        ),
        Index(
            "ix_research_rounds_project_updated",
            "project_id",
            "updated_at",
        ),
        Index(
            "ix_research_rounds_questionnaire_created",
            "questionnaire_id",
            "created_at",
        ),
        Index("ix_research_rounds_status_lease", "status", "lease_expires_at"),
    )

    id: Mapped[UUID] = _uuid_pk()
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=False,
    )
    questionnaire_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("questionnaires.id", ondelete="RESTRICT"),
        nullable=False,
    )
    config_version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("config_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    locale: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    row_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    parent_round_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("research_rounds.id", ondelete="SET NULL"),
    )
    retry_of_round_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("research_rounds.id", ondelete="SET NULL"),
    )
    retry_kind: Mapped[str | None] = mapped_column(String(16))
    total_respondents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    completed_respondents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    terminated_respondents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    failed_respondents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    incomplete_respondents: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    active_respondent_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey(
            "round_respondents.id",
            ondelete="SET NULL",
            use_alter=True,
            name=(
                "fk_research_rounds_active_respondent_id_round_respondents"
            ),
        ),
    )
    pause_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    lease_owner: Mapped[str | None] = mapped_column(String(255))
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    created_at: Mapped[datetime] = _created_at()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        server_default=func.now(),
        onupdate=_utc_now,
    )
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)


class RoundRespondentRow(Base):
    __tablename__ = "round_respondents"
    __table_args__ = (
        UniqueConstraint("round_id", "ordinal", name="uq_round_respondents_ordinal"),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', "
            "'terminated_by_respondent', 'terminated_by_interviewer', "
            "'failed', 'cancelled')",
            name="ck_round_respondents_status",
        ),
        CheckConstraint(
            "ordinal >= 0",
            name="ck_round_respondents_ordinal",
        ),
        CheckConstraint(
            "completed_questions >= 0",
            name="ck_round_respondents_completed_questions",
        ),
        CheckConstraint(
            "total_questions >= 0",
            name="ck_round_respondents_total_questions",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    round_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("research_rounds.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_respondent_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("round_respondents.id", ondelete="SET NULL"),
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    profile_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    completed_questions: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False)
    termination_code: Mapped[str | None] = mapped_column(String(100))
    termination_reason: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SessionRow(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint(
            "round_respondent_id",
            name="uq_sessions_round_respondent_id",
        ),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', "
            "'terminated_by_respondent', 'terminated_by_interviewer', "
            "'failed', 'cancelled')",
            name="ck_sessions_status",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    round_respondent_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("round_respondents.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    termination_code: Mapped[str | None] = mapped_column(String(100))
    termination_reason: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)


class MessageRow(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("session_id", "ordinal", name="uq_messages_ordinal"),
        CheckConstraint(
            "role IN ('interviewer', 'respondent')",
            name="ck_messages_role",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    session_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    question_id: Mapped[str | None] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sentiment: Mapped[str | None] = mapped_column(String(16))
    answer_value_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class ResponseRow(Base):
    __tablename__ = "responses"
    __table_args__ = (
        UniqueConstraint(
            "round_respondent_id",
            "question_id",
            name="uq_responses_respondent_question",
        ),
        CheckConstraint(
            "status IN ('completed', 'partial', "
            "'terminated_by_respondent', 'terminated_by_interviewer')",
            name="ck_responses_status",
        ),
        Index(
            "ix_responses_respondent_created",
            "round_respondent_id",
            "created_at",
        ),
        Index("ix_responses_question_id", "question_id"),
    )

    id: Mapped[UUID] = _uuid_pk()
    round_respondent_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("round_respondents.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[str] = mapped_column(String(255), nullable=False)
    answer_value_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class InferenceResultRow(Base):
    __tablename__ = "inference_results"
    __table_args__ = (
        UniqueConstraint(
            "round_respondent_id",
            "task_id",
            name="uq_inference_results_respondent_task",
        ),
        CheckConstraint(
            "kind IN ('profile', 'attitude')",
            name="ck_inference_results_kind",
        ),
        CheckConstraint(
            "status IN ('completed', 'skipped', 'failed')",
            name="ck_inference_results_status",
        ),
        Index(
            "ix_inference_results_respondent_created",
            "round_respondent_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    round_respondent_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("round_respondents.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[str] = mapped_column(String(255), nullable=False)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    value_json: Mapped[Any | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    evidence_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB,
        nullable=False,
        default=list,
    )
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExportRecordRow(Base):
    __tablename__ = "export_records"
    __table_args__ = (
        CheckConstraint(
            "format IN ('json', 'csv')",
            name="ck_export_records_format",
        ),
        CheckConstraint(
            "scope IN ('full', 'filtered', 'exceptions')",
            name="ck_export_records_scope",
        ),
        CheckConstraint(
            "status IN ('processing', 'succeeded', 'failed')",
            name="ck_export_records_status",
        ),
        Index("ix_export_records_round_created", "round_id", "created_at"),
        Index("ix_export_records_status_created", "status", "created_at"),
        Index(
            "ix_export_records_requester_created",
            "requested_by_user_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = _uuid_pk()
    round_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("research_rounds.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_by_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    format: Mapped[str] = mapped_column(String(8), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    filters_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = _created_at()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(100))
    error_message: Mapped[str | None] = mapped_column(Text)
