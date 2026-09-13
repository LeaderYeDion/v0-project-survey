import importlib.util
import io
from pathlib import Path
from unittest.mock import patch

from app.db import Base
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID


EXPECTED_TABLES = {
    "users",
    "user_sessions",
    "projects",
    "questionnaires",
    "questionnaire_versions",
    "config_versions",
    "research_rounds",
    "round_respondents",
    "sessions",
    "messages",
    "responses",
    "inference_results",
    "export_records",
}


def test_p0_schema_contains_owned_research_graph() -> None:
    assert EXPECTED_TABLES == set(Base.metadata.tables)


def test_top_level_resources_have_owner_path() -> None:
    assert "owner_user_id" in Base.metadata.tables["projects"].c
    assert {
        fk.target_fullname
        for fk in Base.metadata.tables["questionnaires"].foreign_keys
    } >= {"projects.id"}
    assert {
        fk.target_fullname
        for fk in Base.metadata.tables["research_rounds"].foreign_keys
    } >= {"projects.id", "questionnaires.id", "config_versions.id"}


def test_every_table_has_uuid_primary_key() -> None:
    for table_name, table in Base.metadata.tables.items():
        assert list(table.primary_key.columns.keys()) == ["id"], table_name
        assert isinstance(table.c.id.type, UUID), table_name


def test_foreign_keys_declare_delete_behavior() -> None:
    for table_name, table in Base.metadata.tables.items():
        for foreign_key in table.foreign_keys:
            assert foreign_key.ondelete is not None, (
                table_name,
                foreign_key.parent.name,
            )


def test_version_rows_are_immutable_and_uniquely_numbered() -> None:
    questionnaire_versions = Base.metadata.tables["questionnaire_versions"]
    config_versions = Base.metadata.tables["config_versions"]

    assert "updated_at" not in questionnaire_versions.c
    assert "updated_at" not in config_versions.c
    assert _unique_column_sets(questionnaire_versions) >= {
        frozenset({"questionnaire_id", "version_number"})
    }
    assert _unique_column_sets(config_versions) >= {
        frozenset({"project_id", "version_number"})
    }


def test_response_identity_is_unique_per_respondent_and_question() -> None:
    responses = Base.metadata.tables["responses"]
    assert _unique_column_sets(responses) >= {
        frozenset({"round_respondent_id", "question_id"})
    }


def test_json_payloads_use_postgresql_jsonb() -> None:
    json_columns = {
        "questionnaires": {"draft_config"},
        "questionnaire_versions": {"questions_json"},
        "config_versions": {
            "respondent_plan_json",
            "inference_config_json",
            "run_settings_json",
            "full_snapshot_json",
        },
        "round_respondents": {"profile_json"},
        "messages": {"answer_value_json"},
        "responses": {"answer_value_json"},
        "inference_results": {"value_json", "evidence_json"},
        "export_records": {"filters_json"},
    }

    for table_name, column_names in json_columns.items():
        table = Base.metadata.tables[table_name]
        for column_name in column_names:
            assert isinstance(table.c[column_name].type, JSONB), (
                table_name,
                column_name,
            )


def test_status_columns_are_protected_by_check_constraints() -> None:
    status_tables = {
        "research_rounds",
        "round_respondents",
        "sessions",
        "responses",
        "inference_results",
        "export_records",
    }
    for table_name in status_tables:
        table = Base.metadata.tables[table_name]
        check_names = {
            constraint.name
            for constraint in table.constraints
            if isinstance(constraint, CheckConstraint)
        }
        assert f"ck_{table_name}_status" in check_names


def test_ownership_and_list_paths_are_indexed() -> None:
    indexed_paths = {
        "user_sessions": {"user_id"},
        "projects": {"owner_user_id"},
        "questionnaires": {"project_id"},
        "questionnaire_versions": {"questionnaire_id"},
        "config_versions": {"project_id", "questionnaire_version_id"},
        "research_rounds": {"project_id", "questionnaire_id", "status"},
        "round_respondents": {"round_id"},
        "sessions": {"round_respondent_id"},
        "messages": {"session_id"},
        "responses": {"round_respondent_id"},
        "inference_results": {"round_respondent_id"},
        "export_records": {"round_id", "requested_by_user_id"},
    }

    for table_name, column_names in indexed_paths.items():
        table = Base.metadata.tables[table_name]
        indexed_columns = {
            column.name
            for index in [*table.indexes, *(constraint for constraint in table.constraints if isinstance(constraint, UniqueConstraint))]
            for column in index.columns
        }
        assert indexed_columns >= column_names, table_name


def test_initial_migration_creates_and_drops_the_complete_graph_in_order() -> None:
    migration_path = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "20260905_0001_p0_schema.py"
    )
    spec = importlib.util.spec_from_file_location("p0_schema", migration_path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    created: list[str] = []
    dropped: list[str] = []
    with (
        patch.object(
            migration.op,
            "create_table",
            side_effect=lambda name, *args, **kwargs: created.append(name),
        ),
        patch.object(migration.op, "create_index"),
        patch.object(migration.op, "create_foreign_key"),
    ):
        migration.upgrade()
    with (
        patch.object(
            migration.op,
            "drop_table",
            side_effect=lambda name, *args, **kwargs: dropped.append(name),
        ),
        patch.object(migration.op, "drop_index"),
        patch.object(migration.op, "drop_constraint"),
    ):
        migration.downgrade()

    assert created == [
        "users",
        "user_sessions",
        "projects",
        "questionnaires",
        "questionnaire_versions",
        "config_versions",
        "research_rounds",
        "round_respondents",
        "sessions",
        "messages",
        "responses",
        "inference_results",
        "export_records",
    ]
    assert dropped == list(reversed(created))


def test_initial_migration_compiles_for_postgresql() -> None:
    migration_path = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "20260905_0001_p0_schema.py"
    )
    spec = importlib.util.spec_from_file_location(
        "p0_schema_compile",
        migration_path,
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    output = io.StringIO()
    context = MigrationContext.configure(
        url="postgresql+asyncpg://survey:survey@db:5432/survey",
        opts={
            "as_sql": True,
            "output_buffer": output,
            "target_metadata": Base.metadata,
        },
    )

    with patch.object(migration, "op", Operations(context)):
        migration.upgrade()

    sql = output.getvalue()
    assert sql.count("CREATE TABLE") == len(EXPECTED_TABLES)
    assert "CONSTRAINT ck_research_rounds_status CHECK" in sql
    assert "ck_research_rounds_ck_research_rounds_status" not in sql
    assert "CREATE INDEX ix_round_respondents_round_ordinal" not in sql
    assert "CREATE INDEX ix_sessions_round_respondent" not in sql
    assert "CREATE INDEX ix_messages_session_ordinal" not in sql


def test_indexes_do_not_duplicate_unique_constraint_paths() -> None:
    for table in Base.metadata.tables.values():
        unique_paths = {
            tuple(column.name for column in constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, UniqueConstraint)
        }
        for index in table.indexes:
            assert tuple(column.name for column in index.columns) not in unique_paths, index.name


def test_export_stale_processing_scan_has_a_status_created_index() -> None:
    table = Base.metadata.tables["export_records"]
    assert ("status", "created_at") in {
        tuple(column.name for column in index.columns) for index in table.indexes
    }


def _unique_column_sets(table) -> set[frozenset[str]]:
    return {
        frozenset(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
