from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from app.api.errors import ApiError
from round_support import CheckpointGateEngine, build_round_harness


@pytest.mark.asyncio
async def test_pause_waits_for_checkpoint_then_resume_completes() -> None:
    engine = CheckpointGateEngine()
    harness = await build_round_harness(engine=engine)
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await asyncio.wait_for(engine.answer_started.wait(), timeout=1)

    pausing = await harness.service.pause(harness.owner_id, created.id)
    assert pausing.status == "pausing"
    engine.allow_answer.set()
    paused = await harness.service.wait_for_status(
        harness.owner_id,
        created.id,
        "paused",
    )

    checkpoint_count = paused.progress.answeredQuestions
    assert checkpoint_count == 1
    await asyncio.sleep(0.02)
    current = await harness.service.get(harness.owner_id, created.id)
    assert current.progress.answeredQuestions == checkpoint_count

    await harness.service.resume(harness.owner_id, created.id)
    assert (await harness.service.wait(created.id)).status == "completed"


@pytest.mark.asyncio
async def test_illegal_transition_reports_current_status_and_actions() -> None:
    harness = await build_round_harness()
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    completed = await harness.service.wait(created.id)

    with pytest.raises(ApiError) as raised:
        await harness.service.pause(harness.owner_id, completed.id)

    assert raised.value.status_code == 409
    assert raised.value.code == "INVALID_RUN_TRANSITION"
    assert raised.value.details == {
        "currentStatus": "completed",
        "allowedActions": [],
    }


@pytest.mark.asyncio
async def test_cross_owner_round_id_is_indistinguishable_from_missing() -> None:
    harness = await build_round_harness()
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )

    with pytest.raises(ApiError) as cross_owner:
        await harness.service.get(uuid4(), created.id)
    with pytest.raises(ApiError) as missing:
        await harness.service.get(harness.owner_id, uuid4())

    assert (cross_owner.value.status_code, cross_owner.value.code) == (
        404,
        "RESOURCE_NOT_FOUND",
    )
    assert (missing.value.status_code, missing.value.code) == (
        404,
        "RESOURCE_NOT_FOUND",
    )


@pytest.mark.asyncio
async def test_cancel_preserves_checkpoint_and_marks_unfinished_respondents() -> None:
    engine = CheckpointGateEngine()
    harness = await build_round_harness(engine=engine)
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await asyncio.wait_for(engine.answer_started.wait(), timeout=1)

    cancelled = await harness.service.cancel(harness.owner_id, created.id)
    engine.allow_answer.set()
    settled = await harness.service.wait(created.id)
    rows = await harness.repository.get_result_rows_for_owner(
        harness.owner_id,
        created.id,
    )

    assert cancelled.status == settled.status == "cancelled"
    assert rows is not None
    assert {row.status for row in rows.respondents} == {"cancelled"}
    assert rows.messages == ()
    assert rows.responses == ()
