import io
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text


LEGACY_INDEXES = (
    ("round_respondents", "ix_round_respondents_round_ordinal", "round_id, ordinal"),
    ("sessions", "ix_sessions_round_respondent", "round_respondent_id"),
    ("messages", "ix_messages_session_ordinal", "session_id, ordinal"),
)


def maintenance_migration():
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    assert scripts.get_current_head() == "20260912_0002"
    revision = scripts.get_revision("head")
    assert revision.down_revision == "20260905_0001"
    return revision.module


@pytest.mark.parametrize("legacy_indexes", [False, True])
def test_forward_maintenance_upgrades_fresh_and_existing_schemas(legacy_indexes):
    migration = maintenance_migration()
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        for statement in (
            "CREATE TABLE round_respondents (id INTEGER PRIMARY KEY, round_id TEXT, ordinal INTEGER, UNIQUE(round_id, ordinal))",
            "CREATE TABLE sessions (id INTEGER PRIMARY KEY, round_respondent_id TEXT UNIQUE)",
            "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, ordinal INTEGER, UNIQUE(session_id, ordinal))",
            "CREATE TABLE export_records (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT)",
            "INSERT INTO export_records VALUES (1, 'processing', '2026-09-12')",
        ):
            connection.execute(text(statement))
        if legacy_indexes:
            for table, name, columns in LEGACY_INDEXES:
                connection.execute(text(f"CREATE INDEX {name} ON {table} ({columns})"))
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.upgrade()
        inspector = inspect(connection)
        for table, legacy_name, _ in LEGACY_INDEXES:
            assert legacy_name not in {index["name"] for index in inspector.get_indexes(table)}
            assert inspector.get_unique_constraints(table)
        assert {tuple(index["column_names"]) for index in inspector.get_indexes("export_records")} == {("status", "created_at")}
        assert connection.execute(text("SELECT status FROM export_records WHERE id = 1")).scalar() == "processing"
        with patch.object(migration, "op", Operations(MigrationContext.configure(connection))):
            migration.downgrade()
        inspector = inspect(connection)
        assert inspector.get_indexes("export_records") == []
        for table, legacy_name, _ in LEGACY_INDEXES:
            assert legacy_name in {index["name"] for index in inspector.get_indexes(table)}


def test_maintenance_migration_compiles_safe_postgresql_index_operations():
    migration = maintenance_migration()
    output = io.StringIO()
    context = MigrationContext.configure(url="postgresql+asyncpg://unused/unused", opts={"as_sql": True, "output_buffer": output})
    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()
    sql = output.getvalue()
    assert "CREATE INDEX IF NOT EXISTS ix_export_records_status_created ON export_records (status, created_at)" in sql
    for _, name, _ in LEGACY_INDEXES:
        assert f"DROP INDEX IF EXISTS {name}" in sql
    assert "DROP TABLE" not in sql
