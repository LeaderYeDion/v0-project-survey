from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest

from app.api.errors import ApiError
from app.main import create_app
from app.mocks.engine import MockEngine
from app.services.analytics_service import AnalyticsService
from app.services.run_service import RunService
from round_support import (
    CATALOG,
    AlwaysTerminateGateEngine,
    CheckpointGateEngine,
    build_round_harness,
)


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


@pytest.mark.asyncio
async def test_graceful_restart_pauses_future_lease_for_fresh_executor() -> None:
    engine = CheckpointGateEngine()
    harness = await build_round_harness(engine=engine)
    application = create_app(
        repository=harness.repository,
        run_service=harness.service,
        research_service=harness.research,
    )

    async with application.router.lifespan_context(application):
        created = await harness.service.create(
            harness.owner_id,
            harness.questionnaire_id,
            "zh-CN",
        )
        await asyncio.wait_for(engine.answer_started.wait(), timeout=1)
        running = await harness.repository.get_for_owner(
            harness.owner_id,
            UUID(created.id),
        )
        assert running is not None
        assert running.status == "running"
        assert running.lease_expires_at is not None

    recoverable = await harness.service.get(harness.owner_id, created.id)
    assert recoverable.status == "paused"

    engine.allow_answer.set()
    await harness.service.wait(created.id)
    fresh_service = RunService(
        repository=harness.repository,
        research=harness.research,
        engine=MockEngine(CATALOG, delay_scale=0),
        analytics=AnalyticsService(CATALOG),
    )
    await fresh_service.resume(harness.owner_id, created.id)
    assert (await fresh_service.wait(created.id)).status == "completed"


@pytest.mark.asyncio
async def test_pause_checkpoint_preserves_interviewer_termination() -> None:
    engine = AlwaysTerminateGateEngine()
    harness = await build_round_harness(engine=engine)
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await asyncio.wait_for(engine.answer_started.wait(), timeout=1)

    await harness.service.pause(harness.owner_id, created.id)
    engine.allow_answer.set()
    paused = await harness.service.wait_for_status(
        harness.owner_id,
        created.id,
        "paused",
    )

    assert paused.sessions[0].status == "terminated_by_interviewer"
    assert paused.progress.terminatedRespondents == 1
    assert paused.progress.answeredQuestions == 1
    await harness.service.resume(harness.owner_id, created.id)
    completed = await harness.service.wait(created.id)
    assert completed.status == "completed"
    assert completed.sessions[0].status == "terminated_by_interviewer"
