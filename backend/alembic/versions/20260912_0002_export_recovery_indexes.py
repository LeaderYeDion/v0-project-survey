"""Maintain indexes for existing databases and stale export recovery.

Revision ID: 20260912_0002
Revises: 20260905_0001
"""

from alembic import op


revision = "20260912_0002"
down_revision = "20260905_0001"
branch_labels = None
depends_on = None


LEGACY_INDEXES = (
    ("round_respondents", "ix_round_respondents_round_ordinal", ["round_id", "ordinal"]),
    ("sessions", "ix_sessions_round_respondent", ["round_respondent_id"]),
    ("messages", "ix_messages_session_ordinal", ["session_id", "ordinal"]),
)


def upgrade() -> None:
    # Fresh schemas already omit these indexes; older installs still have them.
    for table, name, _columns in LEGACY_INDEXES:
        op.drop_index(name, table_name=table, if_exists=True)
    op.create_index(
        "ix_export_records_status_created", "export_records", ["status", "created_at"],
        unique=False, if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_export_records_status_created", table_name="export_records", if_exists=True)
    for table, name, columns in LEGACY_INDEXES:
        op.create_index(name, table, columns, unique=False, if_not_exists=True)
