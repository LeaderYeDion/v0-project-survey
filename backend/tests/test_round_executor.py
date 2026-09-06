from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.api.errors import ApiError
from app.repositories.memory import MemoryRepository
from app.repositories.protocols import RoundCheckpoint
from research_support import valid_config
from round_support import (
    CheckpointGateEngine,
    FailFirstAnswerEngine,
    build_round_harness,
)


class RejectSecondAnswerRepository(MemoryRepository):
    def __init__(self) -> None:
        super().__init__()
        self._rejected = False

    async def checkpoint(self, *args, **kwargs):
        checkpoint: RoundCheckpoint = kwargs.get("checkpoint") or args[-1]
        if (
            not self._rejected
            and any(row.question_id == "q2" for row in checkpoint.responses)
        ):
            self._rejected = True
            raise RuntimeError("checkpoint transaction rejected")
        return await super().checkpoint(*args, **kwargs)


class PauseAfterAnswerStatusReadRepository(MemoryRepository):
    def __init__(self) -> None:
        super().__init__()
        self._pause_after_next_read = False

    async def checkpoint(self, *args, **kwargs):
        checkpoint: RoundCheckpoint = kwargs.get("checkpoint") or args[-1]
        result = await super().checkpoint(*args, **kwargs)
        if result is not None and checkpoint.responses:
            self._pause_after_next_read = True
        return result

    async def get_for_owner(self, owner_id, round_id):
        row = await super().get_for_owner(owner_id, round_id)
        if (
            self._pause_after_next_read
            and row is not None
            and row.status == "running"
        ):
            self._pause_after_next_read = False
            await super().transition(
                owner_id,
                row.id,
                row.row_version,
                frozenset({"running"}),
                "pausing",
            )
        return row


class PauseInsteadOfCompletionRepository(MemoryRepository):
    def __init__(self) -> None:
        super().__init__()
        self._paused_completion = False

    async def transition(
        self,
        owner_id,
        round_id,
        expected_version,
        from_statuses,
        to_status,
    ):
        if to_status == "completed" and not self._paused_completion:
            self._paused_completion = True
            await super().transition(
                owner_id,
                round_id,
                expected_version,
                frozenset({"running"}),
                "pausing",
            )
            return None
        return await super().transition(
            owner_id,
            round_id,
            expected_version,
            from_statuses,
            to_status,
        )


@pytest.mark.asyncio
async def test_respondent_failure_is_contained_and_retry_copies_profile() -> None:
    config = valid_config()
    config["respondentConfigs"][0]["count"] = 2
    harness = await build_round_harness(
        engine=FailFirstAnswerEngine(),
        config=config,
    )

    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    completed = await harness.service.wait(created.id)
    source_rows = await harness.repository.get_result_rows_for_owner(
        harness.owner_id,
        created.id,
    )

    assert completed.status == "completed_with_errors"
    assert completed.progress.failedRespondents == 1
    assert completed.progress.completedRespondents == 1
    assert source_rows is not None
    failed = next(row for row in source_rows.respondents if row.status == "failed")

    retried = await harness.service.retry(
        harness.owner_id,
        created.id,
        "failed",
    )
    retried = await harness.service.wait(retried.id)
    retry_rows = await harness.repository.get_result_rows_for_owner(
        harness.owner_id,
        retried.id,
    )

    assert retried.status == "completed"
    assert retried.retryOfRoundId == created.id
    assert retried.configVersionId == created.configVersionId
    assert retry_rows is not None
    assert len(retry_rows.respondents) == 1
    assert retry_rows.respondents[0].source_respondent_id == failed.id
    assert retry_rows.respondents[0].profile_json == failed.profile_json


@pytest.mark.asyncio
async def test_retry_incomplete_selects_only_cancelled_rows() -> None:
    engine = CheckpointGateEngine()
    harness = await build_round_harness(engine=engine)
    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    await engine.answer_started.wait()
    await harness.service.cancel(harness.owner_id, created.id)
    engine.allow_answer.set()
    await harness.service.wait(created.id)

    retried = await harness.service.retry(
        harness.owner_id,
        created.id,
        "incomplete",
    )
    retried = await harness.service.wait(retried.id)

    assert retried.status == "completed"
    assert retried.retryKind == "incomplete"
    assert retried.progress.totalRespondents == 2

    with pytest.raises(ApiError) as raised:
        await harness.service.retry(
            harness.owner_id,
            retried.id,
            "incomplete",
        )
    assert (raised.value.status_code, raised.value.code) == (
        422,
        "NO_RETRYABLE_RESPONDENTS",
    )


@pytest.mark.asyncio
async def test_failed_answer_checkpoint_keeps_previous_checkpoint_intact() -> None:
    config = valid_config()
    config["respondentConfigs"][0]["count"] = 1
    config["questions"].append(
        {
            "id": "q2",
            "type": "text",
            "question": "Explain why",
        }
    )
    repository = RejectSecondAnswerRepository()
    harness = await build_round_harness(
        repository=repository,
        config=config,
    )

    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    completed = await harness.service.wait(created.id)
    rows = await repository.get_result_rows_for_owner(
        harness.owner_id,
        created.id,
    )

    assert completed.status == "completed_with_errors"
    assert rows is not None
    assert [row.question_id for row in rows.responses] == ["q1"]
    assert [row.question_id for row in rows.messages] == ["q1", "q1"]
    assert rows.respondents[0].completed_questions == 1


@pytest.mark.asyncio
async def test_reconcile_pauses_expired_active_rounds_with_stable_error() -> None:
    harness = await build_round_harness()
    frozen = await harness.research.freeze_config(
        harness.owner_id,
        harness.questionnaire_id,
    )
    questionnaire = await harness.research.get_questionnaire(
        harness.owner_id,
        harness.questionnaire_id,
    )
    row = await harness.repository.create_round(
        harness.owner_id,
        {
            "project_id": questionnaire.project_id,
            "questionnaire_id": questionnaire.id,
            "config_version_id": frozen.config_version_id,
            "name": frozen.config.title,
            "mode": questionnaire.mode,
            "locale": "zh-CN",
            "respondents": [],
        },
    )
    leased = await harness.repository.acquire_lease(
        harness.owner_id,
        row.id,
        "dead-worker",
        datetime.now(UTC) - timedelta(seconds=5),
        row.row_version,
    )
    assert leased is not None
    running = await harness.repository.transition(
        harness.owner_id,
        row.id,
        leased.row_version,
        frozenset({"queued"}),
        "running",
    )
    assert running is not None

    reconciled = await harness.service.executor.reconcile_interrupted_rounds()
    current = await harness.repository.get_for_owner(harness.owner_id, row.id)

    assert [item.id for item in reconciled] == [row.id]
    assert current is not None
    assert current.status == "paused"
    assert current.error_code == "RUN_INTERRUPTED_BY_RESTART"
    assert current.lease_owner is None


@pytest.mark.asyncio
async def test_pause_after_last_answer_status_read_reaches_checkpoint() -> None:
    repository = PauseAfterAnswerStatusReadRepository()
    config = valid_config()
    config["respondentConfigs"][0]["count"] = 1
    harness = await build_round_harness(repository=repository, config=config)

    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    settled = await harness.service.wait(created.id)

    assert settled.status == "paused"
    assert settled.progress.answeredQuestions == 1


@pytest.mark.asyncio
async def test_pause_winning_final_completion_cas_becomes_resumable() -> None:
    repository = PauseInsteadOfCompletionRepository()
    config = valid_config()
    config["respondentConfigs"][0]["count"] = 1
    harness = await build_round_harness(repository=repository, config=config)

    created = await harness.service.create(
        harness.owner_id,
        harness.questionnaire_id,
        "zh-CN",
    )
    paused = await harness.service.wait(created.id)

    assert paused.status == "paused"
    await harness.service.resume(harness.owner_id, created.id)
    assert (await harness.service.wait(created.id)).status == "completed"
