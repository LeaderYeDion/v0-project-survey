from __future__ import annotations

import pytest

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
