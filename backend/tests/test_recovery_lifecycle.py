import asyncio
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from app.api.errors import ApiError
from app.main import create_app
from app.mocks.engine import MockEngine
from app.services.analytics_service import AnalyticsService
from app.services.run_service import RunService
from round_support import CATALOG, CheckpointGateEngine, build_round_harness


@pytest.mark.asyncio
async def test_crashed_worker_future_lease_becomes_paused_and_resumable():
    engine = CheckpointGateEngine()
    harness = await build_round_harness(engine=engine)
    harness.service.executor._lease_seconds = 0.1
    created = await harness.service.create(harness.owner_id, harness.questionnaire_id, "zh-CN")
    await engine.answer_started.wait()
    worker = harness.service.executor._tasks[UUID(created.id)]
    worker.cancel()  # Hard crash: no graceful shutdown/release of the lease.
    with suppress(asyncio.CancelledError):
        await worker
    fresh = RunService(repository=harness.repository, research=harness.research,
        engine=MockEngine(CATALOG, delay_scale=0), analytics=AnalyticsService(CATALOG))
    application = create_app(repository=harness.repository, run_service=fresh, research_service=harness.research)
    application.state.recovery.interval_seconds = 0.005
    async with application.router.lifespan_context(application):
        row = await harness.repository.get_for_owner(harness.owner_id, UUID(created.id))
        assert row.lease_expires_at > datetime.now(UTC)
        assert row.status == "running"
        async with asyncio.timeout(2):
            while (await fresh.get(harness.owner_id, created.id)).status != "paused":
                await asyncio.sleep(0.005)
        row = await harness.repository.get_for_owner(harness.owner_id, UUID(created.id))
        assert row.error_code == "RUN_INTERRUPTED_BY_RESTART"
        assert row.lease_owner is None
        await fresh.resume(harness.owner_id, created.id)
        assert (await fresh.wait(created.id)).status == "completed"


@pytest.mark.asyncio
async def test_recovery_retries_storage_failure_and_stops_on_lifespan_exit(monkeypatch, caplog):
    harness = await build_round_harness()
    application = create_app(repository=harness.repository, run_service=harness.service, research_service=harness.research)
    application.state.recovery.interval_seconds = 0.005
    original = harness.repository.reconcile_interrupted_rounds
    recovered = asyncio.Event()
    calls = 0
    async def fail_once(now):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ApiError(503, "STORAGE_UNAVAILABLE", "private-token")
        result = await original(now)
        recovered.set()
        return result
    monkeypatch.setattr(harness.repository, "reconcile_interrupted_rounds", fail_once)
    async with application.router.lifespan_context(application):
        await asyncio.wait_for(recovered.wait(), timeout=1)
    calls_at_shutdown = calls
    await asyncio.sleep(0.02)
    assert calls == calls_at_shutdown
    assert application.state.recovery._task is None
    assert "STORAGE_UNAVAILABLE" in caplog.text
    assert "private-token" not in caplog.text


@pytest.mark.asyncio
async def test_lifespan_periodically_recovers_stale_processing_exports():
    harness = await build_round_harness()
    created = await harness.service.create(harness.owner_id, harness.questionnaire_id, "zh-CN")
    await harness.service.wait(created.id)
    application = create_app(repository=harness.repository, run_service=harness.service, research_service=harness.research)
    application.state.recovery.interval_seconds = 0.005
    service = application.state.export_service
    service.processing_timeout = timedelta(seconds=0.03)
    async with application.router.lifespan_context(application):
        record = await service.repository.create_export(harness.owner_id, UUID(created.id),
            {"format": "json", "scope": "full", "filters_json": {}, "filename": "interrupted.json"})
        assert record.status == "processing"
        async with asyncio.timeout(1):
            while True:
                rows = await service.repository.list_exports_for_owner(harness.owner_id, UUID(created.id))
                if rows[0].status == "failed":
                    break
                await asyncio.sleep(0.005)
        assert rows[0].error_code == "EXPORT_GENERATION_INTERRUPTED"
