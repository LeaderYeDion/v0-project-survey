from __future__ import annotations

from uuid import uuid4

import pytest

from app.api.errors import ApiError
from round_support import build_round_harness


@pytest.mark.asyncio
async def test_completed_snapshot_is_rebuilt_from_normalized_rows() -> None:
    harness = await build_round_harness()
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )

    completed = await harness.service.wait(created.id)
    stored = await harness.repository.get_result_rows_for_owner(
        harness.owner_id,
        completed.id,
    )
    fetched = await harness.service.get(harness.owner_id, completed.id)

    assert completed.status == fetched.status == "completed"
    assert stored is not None
    assert len(fetched.sessions) == len(stored.sessions) == 2
    assert len(fetched.responses) == len(stored.respondents) == 2
    assert fetched.progress.answeredQuestions == len(stored.responses) == 2
    assert fetched.questionAnalysis[0].totalResponses == 2
    assert fetched.name == "Original survey"
    assert fetched.questionnaireVersionId
    assert fetched.configVersionId == completed.configVersionId
    assert fetched.rowVersion > 0


@pytest.mark.asyncio
async def test_round_listing_is_project_scoped_and_newest_first() -> None:
    harness = await build_round_harness()
    first = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await harness.service.wait(first.id)
    second = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await harness.service.wait(second.id)

    listed = await harness.service.list_for_project(
        harness.owner_id,
        first.projectId,
    )

    assert [item.id for item in listed] == [second.id, first.id]


@pytest.mark.asyncio
async def test_interview_inference_is_persisted_and_reloaded() -> None:
    config = {
        "title": "Interview",
        "description": "Inference coverage",
        "questions": [
            {"id": "q1", "type": "text", "question": "Why?"},
        ],
        "maxResponseTime": 90,
        "respondentConfigs": [
            {
                "id": "group-1",
                "gender": "不限",
                "ageRange": "18-65",
                "occupation": "研究员",
                "city": "杭州",
                "income": "20万-50万",
                "count": 1,
            }
        ],
        "inferenceConfig": {
            "enabled": True,
            "profileEnabled": True,
            "attitudeEnabled": False,
            "profileTasks": [
                {
                    "id": "profile-income",
                    "name": "家庭年收入",
                    "options": ["5万以下", "5万-20万", "20万-50万"],
                    "multiple": False,
                    "enabled": True,
                }
            ],
            "attitudeTasks": [],
        },
    }
    harness = await build_round_harness(config=config, mode="interview")

    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    completed = await harness.service.wait(created.id)
    rows = await harness.repository.get_result_rows_for_owner(
        harness.owner_id,
        completed.id,
    )

    assert completed.status == "completed"
    assert len(completed.inferenceResults) == 1
    assert completed.inferenceResults[0].kind == "profile"
    assert rows is not None
    assert len(rows.inference_results) == 1


@pytest.mark.asyncio
async def test_copy_creates_independent_draft_from_immutable_config() -> None:
    harness = await build_round_harness()
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    source = await harness.service.wait(created.id)

    copied = await harness.service.copy(harness.owner_id, created.id)
    edited_config = copied.config.model_copy(
        update={"title": "Edited independent draft"},
        deep=True,
    )
    edited = await harness.research.save_draft(
        harness.owner_id,
        copied.id,
        edited_config,
        copied.draft_revision,
    )
    unchanged_source = await harness.service.get(
        harness.owner_id,
        created.id,
    )
    rounds = await harness.service.list_for_project(
        harness.owner_id,
        source.projectId,
    )

    assert copied.id != harness.questionnaire_id
    assert str(copied.project_id) == source.projectId
    assert copied.config == source.config
    assert copied.draft_revision == 1
    assert edited.title == "Edited independent draft"
    assert unchanged_source.config.title == "Original survey"
    assert unchanged_source.status == source.status
    assert unchanged_source.rowVersion == source.rowVersion
    assert [row.id for row in rounds] == [created.id]

    with pytest.raises(ApiError) as raised:
        await harness.service.copy(uuid4(), created.id)
    assert (raised.value.status_code, raised.value.code) == (
        404,
        "RESOURCE_NOT_FOUND",
    )
