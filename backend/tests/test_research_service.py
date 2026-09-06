from __future__ import annotations

from uuid import uuid4

import pytest

from app.api.errors import ApiError
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
