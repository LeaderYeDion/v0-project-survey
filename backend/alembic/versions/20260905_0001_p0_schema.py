"""Create the P0 persistence schema.

Revision ID: 20260905_0001
Revises:
Create Date: 2026-09-05
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260905_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _id_column() -> sa.Column:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _created_at_column() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "users",
        _id_column(),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        _created_at_column(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_table(
        "user_sessions",
        _id_column(),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        _created_at_column(),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    op.create_index(
        "ix_user_sessions_user_expires",
        "user_sessions",
        ["user_id", "expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_user_sessions_expires_at",
        "user_sessions",
        ["expires_at"],
        unique=False,
    )
    op.create_table(
        "projects",
        _id_column(),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("research_goal", sa.Text(), nullable=False),
        sa.Column("principal_name", sa.String(length=255), nullable=False),
        _created_at_column(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["owner_user_id"],
            ["users.id"],
            name="fk_projects_owner_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_projects"),
    )
    op.create_index(
        "ix_projects_owner_updated",
        "projects",
        ["owner_user_id", "updated_at"],
        unique=False,
    )
    op.create_table(
        "questionnaires",
        _id_column(),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("draft_config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("draft_schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "draft_revision",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        _created_at_column(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("draft_revision >= 0", name="ck_questionnaires_draft_revision"),
        sa.CheckConstraint(
            "mode IN ('survey', 'interview')",
            name="ck_questionnaires_mode",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_questionnaires_project_id_projects",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_questionnaires"),
    )
    op.create_index(
        "ix_questionnaires_project_updated",
        "questionnaires",
        ["project_id", "updated_at"],
        unique=False,
    )
    op.create_table(
        "questionnaire_versions",
        _id_column(),
        sa.Column(
            "questionnaire_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "questions_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        _created_at_column(),
        sa.CheckConstraint(
            "schema_version > 0",
            name="ck_questionnaire_versions_schema_version",
        ),
        sa.CheckConstraint(
            "version_number > 0",
            name="ck_questionnaire_versions_version_number",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_questionnaire_versions_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"],
            ["questionnaires.id"],
            name="fk_questionnaire_versions_questionnaire_id_questionnaires",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_questionnaire_versions"),
        sa.UniqueConstraint(
            "questionnaire_id",
            "schema_version",
            "content_hash",
            name="uq_questionnaire_versions_content",
        ),
        sa.UniqueConstraint(
            "questionnaire_id",
            "version_number",
            name="uq_questionnaire_versions_number",
        ),
    )
    op.create_index(
        "ix_questionnaire_versions_questionnaire_created",
        "questionnaire_versions",
        ["questionnaire_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "config_versions",
        _id_column(),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "questionnaire_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "respondent_plan_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "inference_config_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "run_settings_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "full_snapshot_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        _created_at_column(),
        sa.CheckConstraint(
            "schema_version > 0",
            name="ck_config_versions_schema_version",
        ),
        sa.CheckConstraint(
            "version_number > 0",
            name="ck_config_versions_version_number",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_config_versions_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_config_versions_project_id_projects",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_version_id"],
            ["questionnaire_versions.id"],
            name="fk_config_versions_questionnaire_version",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_config_versions"),
        sa.UniqueConstraint(
            "project_id",
            "questionnaire_version_id",
            "schema_version",
            "content_hash",
            name="uq_config_versions_content",
        ),
        sa.UniqueConstraint(
            "project_id",
            "version_number",
            name="uq_config_versions_number",
        ),
    )
    op.create_index(
        "ix_config_versions_project_created",
        "config_versions",
        ["project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_config_versions_questionnaire_version",
        "config_versions",
        ["questionnaire_version_id"],
        unique=False,
    )
    op.create_table(
        "research_rounds",
        _id_column(),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "questionnaire_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "config_version_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "parent_round_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "retry_of_round_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("retry_kind", sa.String(length=16), nullable=True),
        sa.Column(
            "total_respondents",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "completed_respondents",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "terminated_respondents",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "failed_respondents",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "incomplete_respondents",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "active_respondent_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("pause_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        _created_at_column(),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "completed_respondents >= 0",
            name="ck_research_rounds_completed_respondents",
        ),
        sa.CheckConstraint(
            "failed_respondents >= 0",
            name="ck_research_rounds_failed_respondents",
        ),
        sa.CheckConstraint(
            "incomplete_respondents >= 0",
            name="ck_research_rounds_incomplete_respondents",
        ),
        sa.CheckConstraint(
            "mode IN ('survey', 'interview')",
            name="ck_research_rounds_mode",
        ),
        sa.CheckConstraint(
            "retry_kind IS NULL OR retry_kind IN ('failed', 'incomplete')",
            name="ck_research_rounds_retry_kind",
        ),
        sa.CheckConstraint(
            "row_version >= 0",
            name="ck_research_rounds_row_version",
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'pausing', 'paused', 'completed', "
            "'completed_with_errors', 'failed', 'cancelled')",
            name="ck_research_rounds_status",
        ),
        sa.CheckConstraint(
            "terminated_respondents >= 0",
            name="ck_research_rounds_terminated_respondents",
        ),
        sa.CheckConstraint(
            "total_respondents >= 0",
            name="ck_research_rounds_total_respondents",
        ),
        sa.ForeignKeyConstraint(
            ["config_version_id"],
            ["config_versions.id"],
            name="fk_research_rounds_config_version_id_config_versions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["parent_round_id"],
            ["research_rounds.id"],
            name="fk_research_rounds_parent_round_id_research_rounds",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name="fk_research_rounds_project_id_projects",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"],
            ["questionnaires.id"],
            name="fk_research_rounds_questionnaire_id_questionnaires",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["retry_of_round_id"],
            ["research_rounds.id"],
            name="fk_research_rounds_retry_of_round_id_research_rounds",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_research_rounds"),
    )
    op.create_index(
        "ix_research_rounds_project_updated",
        "research_rounds",
        ["project_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_research_rounds_questionnaire_created",
        "research_rounds",
        ["questionnaire_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_research_rounds_status_lease",
        "research_rounds",
        ["status", "lease_expires_at"],
        unique=False,
    )
    op.create_table(
        "round_respondents",
        _id_column(),
        sa.Column("round_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "source_respondent_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column(
            "profile_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column(
            "completed_questions",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("total_questions", sa.Integer(), nullable=False),
        sa.Column("termination_code", sa.String(length=100), nullable=True),
        sa.Column("termination_reason", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "completed_questions >= 0",
            name="ck_round_respondents_completed_questions",
        ),
        sa.CheckConstraint("ordinal >= 0", name="ck_round_respondents_ordinal"),
        sa.CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', "
            "'terminated_by_respondent', 'terminated_by_interviewer', "
            "'failed', 'cancelled')",
            name="ck_round_respondents_status",
        ),
        sa.CheckConstraint(
            "total_questions >= 0",
            name="ck_round_respondents_total_questions",
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["research_rounds.id"],
            name="fk_round_respondents_round_id_research_rounds",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_respondent_id"],
            ["round_respondents.id"],
            name="fk_round_respondents_source_respondent_id_round_respondents",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_round_respondents"),
        sa.UniqueConstraint(
            "round_id",
            "ordinal",
            name="uq_round_respondents_ordinal",
        ),
    )
    op.create_foreign_key(
        "fk_research_rounds_active_respondent_id_round_respondents",
        "research_rounds",
        "round_respondents",
        ["active_respondent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "sessions",
        _id_column(),
        sa.Column(
            "round_respondent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("termination_code", sa.String(length=100), nullable=True),
        sa.Column("termination_reason", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', "
            "'terminated_by_respondent', 'terminated_by_interviewer', "
            "'failed', 'cancelled')",
            name="ck_sessions_status",
        ),
        sa.ForeignKeyConstraint(
            ["round_respondent_id"],
            ["round_respondents.id"],
            name="fk_sessions_round_respondent_id_round_respondents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.UniqueConstraint(
            "round_respondent_id",
            name="uq_sessions_round_respondent_id",
        ),
    )
    op.create_table(
        "messages",
        _id_column(),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("question_id", sa.String(length=255), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sentiment", sa.String(length=16), nullable=True),
        sa.Column(
            "answer_value_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        _created_at_column(),
        sa.CheckConstraint(
            "role IN ('interviewer', 'respondent')",
            name="ck_messages_role",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_messages_session_id_sessions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_messages"),
        sa.UniqueConstraint("session_id", "ordinal", name="uq_messages_ordinal"),
    )
    op.create_table(
        "responses",
        _id_column(),
        sa.Column(
            "round_respondent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("question_id", sa.String(length=255), nullable=False),
        sa.Column(
            "answer_value_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=40), nullable=False),
        _created_at_column(),
        sa.CheckConstraint(
            "status IN ('completed', 'partial', 'terminated_by_respondent', "
            "'terminated_by_interviewer')",
            name="ck_responses_status",
        ),
        sa.ForeignKeyConstraint(
            ["round_respondent_id"],
            ["round_respondents.id"],
            name="fk_responses_round_respondent_id_round_respondents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_responses"),
        sa.UniqueConstraint(
            "round_respondent_id",
            "question_id",
            name="uq_responses_respondent_question",
        ),
    )
    op.create_index(
        "ix_responses_question_id",
        "responses",
        ["question_id"],
        unique=False,
    )
    op.create_index(
        "ix_responses_respondent_created",
        "responses",
        ["round_respondent_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "inference_results",
        _id_column(),
        sa.Column(
            "round_respondent_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("task_id", sa.String(length=255), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "value_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "evidence_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        _created_at_column(),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('profile', 'attitude')",
            name="ck_inference_results_kind",
        ),
        sa.CheckConstraint(
            "status IN ('completed', 'skipped', 'failed')",
            name="ck_inference_results_status",
        ),
        sa.ForeignKeyConstraint(
            ["round_respondent_id"],
            ["round_respondents.id"],
            name="fk_inference_results_round_respondent_id_round_respondents",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_inference_results"),
        sa.UniqueConstraint(
            "round_respondent_id",
            "task_id",
            name="uq_inference_results_respondent_task",
        ),
    )
    op.create_index(
        "ix_inference_results_respondent_created",
        "inference_results",
        ["round_respondent_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "export_records",
        _id_column(),
        sa.Column("round_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "requested_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("format", sa.String(length=8), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column(
            "filters_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        _created_at_column(),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "format IN ('json', 'csv')",
            name="ck_export_records_format",
        ),
        sa.CheckConstraint(
            "scope IN ('full', 'filtered', 'exceptions')",
            name="ck_export_records_scope",
        ),
        sa.CheckConstraint(
            "status IN ('processing', 'succeeded', 'failed')",
            name="ck_export_records_status",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["users.id"],
            name="fk_export_records_requested_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["round_id"],
            ["research_rounds.id"],
            name="fk_export_records_round_id_research_rounds",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_export_records"),
    )
    op.create_index(
        "ix_export_records_requester_created",
        "export_records",
        ["requested_by_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_export_records_round_created",
        "export_records",
        ["round_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("export_records")
    op.drop_table("inference_results")
    op.drop_table("responses")
    op.drop_table("messages")
    op.drop_table("sessions")
    op.drop_constraint(
        "fk_research_rounds_active_respondent_id_round_respondents",
        "research_rounds",
        type_="foreignkey",
    )
    op.drop_table("round_respondents")
    op.drop_table("research_rounds")
    op.drop_table("config_versions")
    op.drop_table("questionnaire_versions")
    op.drop_table("questionnaires")
    op.drop_table("projects")
    op.drop_table("user_sessions")
    op.drop_table("users")
