from __future__ import annotations

import hashlib
import json
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.api.errors import ApiError
from app.db.models import ProjectRow, QuestionnaireRow
from app.repositories.protocols import VersionFreezePayload
from app.repositories.research import ResearchRepository
from app.schemas.research import CreateProject, CreateQuestionnaire
from app.schemas.survey import SurveyConfig
from app.services.research_service import ResearchService
from research_support import FakeResearchRepository, valid_config


@pytest.fixture
def repository() -> FakeResearchRepository:
    return FakeResearchRepository()


@pytest.fixture
def research_service(repository: FakeResearchRepository) -> ResearchService:
    return ResearchService(repository)


@pytest.mark.asyncio
async def test_freeze_creates_immutable_content_hashed_version(
    research_service: ResearchService,
) -> None:
    alice_id = uuid4()
    project = await research_service.create_project(
        alice_id,
        CreateProject(name="A", researchGoal="G", principalName="Alice"),
    )
    original = SurveyConfig.model_validate(valid_config())
    questionnaire = await research_service.create_questionnaire(
        alice_id,
        project.id,
        CreateQuestionnaire(mode="survey", config=original),
    )

    frozen = await research_service.freeze_config(alice_id, questionnaire.id)
    changed = SurveyConfig.model_validate(valid_config(title="Changed survey"))
    await research_service.save_draft(
        alice_id,
        questionnaire.id,
        changed,
        expected_revision=1,
    )
    loaded = await research_service.get_config_version(
        alice_id,
        frozen.config_version_id,
    )

    assert loaded.full_snapshot.title == "Original survey"
    assert loaded.full_snapshot.title != changed.title


@pytest.mark.asyncio
async def test_freezing_unchanged_draft_reuses_both_versions(
    research_service: ResearchService,
) -> None:
    owner_id = uuid4()
    project = await research_service.create_project(
        owner_id,
        CreateProject(name="A", researchGoal="G", principalName="Owner"),
    )
    questionnaire = await research_service.create_questionnaire(
        owner_id,
        project.id,
        CreateQuestionnaire(
            mode="survey",
            config=SurveyConfig.model_validate(valid_config()),
        ),
    )

    first = await research_service.freeze_config(owner_id, questionnaire.id)
    second = await research_service.freeze_config(owner_id, questionnaire.id)

    assert second.questionnaire_version_id == first.questionnaire_version_id
    assert second.config_version_id == first.config_version_id


@pytest.mark.asyncio
async def test_freeze_rejects_draft_changed_before_transaction_lock(
    research_service: ResearchService,
    repository: FakeResearchRepository,
) -> None:
    owner_id = uuid4()
    project = await research_service.create_project(
        owner_id,
        CreateProject(name="A", researchGoal="G", principalName="Owner"),
    )
    questionnaire = await research_service.create_questionnaire(
        owner_id,
        project.id,
        CreateQuestionnaire(
            mode="survey",
            config=SurveyConfig.model_validate(valid_config()),
        ),
    )

    def concurrent_save(row) -> None:
        row.draft_config = valid_config(title="Concurrent revision")
        row.title = "Concurrent revision"
        row.draft_revision = 2

    repository.before_freeze = concurrent_save

    with pytest.raises(ApiError) as caught:
        await research_service.freeze_config(owner_id, questionnaire.id)

    assert caught.value.status_code == 409
    assert caught.value.code == "DRAFT_CONFLICT"
    assert repository.questionnaire_versions == {}
    assert repository.config_versions == {}


@pytest.mark.asyncio
async def test_stale_draft_save_returns_stable_conflict(
    research_service: ResearchService,
) -> None:
    owner_id = uuid4()
    project = await research_service.create_project(
        owner_id,
        CreateProject(name="A", researchGoal="G", principalName="Owner"),
    )
    questionnaire = await research_service.create_questionnaire(
        owner_id,
        project.id,
        CreateQuestionnaire(
            mode="survey",
            config=SurveyConfig.model_validate(valid_config()),
        ),
    )
    await research_service.save_draft(
        owner_id,
        questionnaire.id,
        SurveyConfig.model_validate(valid_config(title="Revision 2")),
        expected_revision=1,
    )

    with pytest.raises(ApiError) as caught:
        await research_service.save_draft(
            owner_id,
            questionnaire.id,
            SurveyConfig.model_validate(valid_config(title="Lost update")),
            expected_revision=1,
        )

    assert caught.value.status_code == 409
    assert caught.value.code == "DRAFT_CONFLICT"


@pytest.mark.asyncio
async def test_unknown_draft_schema_version_is_rejected(
    research_service: ResearchService,
    repository: FakeResearchRepository,
) -> None:
    owner_id = uuid4()
    project = await research_service.create_project(
        owner_id,
        CreateProject(name="A", researchGoal="G", principalName="Owner"),
    )
    questionnaire = await research_service.create_questionnaire(
        owner_id,
        project.id,
        CreateQuestionnaire(
            mode="survey",
            config=SurveyConfig.model_validate(valid_config()),
        ),
    )
    repository.questionnaires[questionnaire.id].draft_schema_version = 99

    with pytest.raises(ApiError) as caught:
        await research_service.freeze_config(owner_id, questionnaire.id)

    assert caught.value.status_code == 422
    assert caught.value.code == "CONFIG_VERSION_UNSUPPORTED"


@pytest.mark.asyncio
async def test_cross_owner_resources_are_indistinguishable_from_missing(
    research_service: ResearchService,
) -> None:
    alice_id = uuid4()
    bob_id = uuid4()
    project = await research_service.create_project(
        alice_id,
        CreateProject(name="A", researchGoal="G", principalName="Alice"),
    )

    for project_id in (project.id, uuid4()):
        with pytest.raises(ApiError) as caught:
            await research_service.get_project(bob_id, project_id)
        assert caught.value.status_code == 404
        assert caught.value.code == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_freeze_version_queries_each_scope_through_owned_project() -> None:
    owner_id = uuid4()
    project_id = uuid4()
    questionnaire_id = uuid4()
    config = valid_config()
    questionnaire = QuestionnaireRow(
        id=questionnaire_id,
        project_id=project_id,
        draft_config=config,
        draft_revision=1,
    )
    project = ProjectRow(id=project_id, owner_user_id=owner_id)
    session = _RecordingSession(
        [questionnaire, project, None, 0, None, 0]
    )
    repository = ResearchRepository(lambda: session)
    payload = VersionFreezePayload(
        schema_version=1,
        expected_draft_revision=1,
        expected_draft_content_hash=_canonical_hash(config),
        questions_json=config["questions"],
        respondent_plan_json=config["respondentConfigs"],
        inference_config_json=None,
        run_settings_json={"maxResponseTime": 90},
        full_snapshot_json=config,
        questionnaire_content_hash="q" * 64,
        config_content_hash="c" * 64,
    )

    frozen = await repository.freeze_versions(
        owner_id,
        questionnaire_id,
        payload,
    )

    assert frozen is not None
    version_sql = [
        str(
            statement.compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        for statement in session.statements[2:]
    ]
    assert len(version_sql) == 4
    for statement in version_sql:
        assert "JOIN projects" in statement
        assert "projects.owner_user_id" in statement


class _RecordingSession:
    def __init__(self, scalar_results: list[object]) -> None:
        self.scalar_results = scalar_results
        self.statements = []
        self.added = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> None:
        return None

    def begin(self):
        return _AsyncContext()

    async def scalar(self, statement):
        self.statements.append(statement)
        return self.scalar_results.pop(0)

    def add(self, row) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        for row in self.added:
            if row.id is None:
                row.id = uuid4()


class _AsyncContext:
    async def __aenter__(self):
        return None

    async def __aexit__(self, *_args) -> None:
        return None


def _canonical_hash(value) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
