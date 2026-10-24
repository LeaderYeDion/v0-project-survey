from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.db.models import (
    InferenceResultRow,
    MessageRow,
    ResearchRoundRow,
    ResponseRow,
    RoundRespondentRow,
    SessionRow,
)
from app.repositories.protocols import (
    RetryKind,
    RoundCheckpoint,
    RoundResultRows,
)
from app.repositories.rounds import ALLOWED_TRANSITIONS


class MemoryRepository:
    """Protocol-conforming round repository for pure business tests."""

    def __init__(self) -> None:
        self._rounds: dict[UUID, ResearchRoundRow] = {}
        self._owners: dict[UUID, UUID] = {}
        self._respondents: dict[UUID, RoundRespondentRow] = {}
        self._sessions: dict[UUID, SessionRow] = {}
        self._messages: dict[UUID, MessageRow] = {}
        self._responses: dict[UUID, ResponseRow] = {}
        self._inference_results: dict[UUID, InferenceResultRow] = {}
        self._lock = asyncio.Lock()

    async def create_round(self, owner_id: UUID, payload) -> ResearchRoundRow:
        async with self._lock:
            now = datetime.now(UTC)
            round_id = uuid4()
            respondents = list(payload.get("respondents", ()))
            row = ResearchRoundRow(
                id=round_id,
                project_id=payload["project_id"],
                questionnaire_id=payload["questionnaire_id"],
                config_version_id=payload["config_version_id"],
                name=payload["name"],
                    execution_context=payload.get("execution_context"),
                mode=payload["mode"],
                locale=payload["locale"],
                status="queued",
                row_version=0,
                parent_round_id=payload.get("parent_round_id"),
                retry_of_round_id=payload.get("retry_of_round_id"),
                retry_kind=payload.get("retry_kind"),
                total_respondents=len(respondents),
                completed_respondents=0,
                terminated_respondents=0,
                failed_respondents=0,
                incomplete_respondents=len(respondents),
                active_respondent_id=None,
                pause_requested_at=None,
                lease_owner=None,
                lease_expires_at=None,
                created_at=now,
                started_at=None,
                finished_at=None,
                updated_at=now,
                error_code=None,
                error_message=None,
            )
            self._rounds[round_id] = row
            self._owners[round_id] = owner_id
            for ordinal, item in enumerate(respondents):
                respondent_id = uuid4()
                respondent = RoundRespondentRow(
                    id=respondent_id,
                    round_id=round_id,
                    source_respondent_id=item.get("source_respondent_id"),
                    ordinal=ordinal,
                    profile_json=deepcopy(item["profile_json"]),
                    status="pending",
                    completed_questions=0,
                    total_questions=item["total_questions"],
                    termination_code=None,
                    termination_reason=None,
                    error_code=None,
                    error_message=None,
                    started_at=None,
                    finished_at=None,
                )
                session = SessionRow(
                    id=uuid4(),
                    round_respondent_id=respondent_id,
                    status="pending",
                    started_at=None,
                    finished_at=None,
                    termination_code=None,
                    termination_reason=None,
                    error_code=None,
                    error_message=None,
                )
                self._respondents[respondent.id] = respondent
                self._sessions[session.id] = session
            return _copy_row(row)

    async def get_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> ResearchRoundRow | None:
        async with self._lock:
            row = self._owned(owner_id, round_id)
            return _copy_row(row) if row is not None else None

    async def get_owner_id(self, round_id: UUID) -> UUID | None:
        async with self._lock:
            return self._owners.get(round_id)

    async def list_rounds_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID | None = None,
    ) -> tuple[ResearchRoundRow, ...]:
        async with self._lock:
            rows = [
                row
                for round_id, row in self._rounds.items()
                if self._owners[round_id] == owner_id
                and (
                    questionnaire_id is None
                    or row.questionnaire_id == questionnaire_id
                )
            ]
            rows.sort(key=lambda row: (row.created_at, row.id), reverse=True)
            return tuple(_copy_row(row) for row in rows)

    async def transition(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        from_statuses: frozenset[str],
        to_status: str,
    ) -> ResearchRoundRow | None:
        async with self._lock:
            row = self._owned(owner_id, round_id)
            if (
                row is None
                or row.row_version != expected_version
                or row.status not in from_statuses
                or to_status not in ALLOWED_TRANSITIONS.get(row.status, ())
            ):
                return None
            now = datetime.now(UTC)
            row.status = to_status
            row.row_version += 1
            row.updated_at = now
            if to_status == "pausing":
                row.pause_requested_at = now
            elif to_status == "running":
                row.pause_requested_at = None
                row.error_code = None
                row.error_message = None
                row.started_at = row.started_at or now
            if to_status in {
                "paused",
                "completed",
                "completed_with_errors",
                "failed",
                "cancelled",
            }:
                row.active_respondent_id = None
                row.lease_owner = None
                row.lease_expires_at = None
            if to_status in {
                "completed",
                "completed_with_errors",
                "failed",
                "cancelled",
            }:
                row.finished_at = now
            if to_status == "cancelled":
                self._cancel_unfinished(round_id, now)
            return _copy_row(row)

    async def acquire_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        lease_expires_at: datetime,
        expected_version: int,
    ) -> ResearchRoundRow | None:
        async with self._lock:
            row = self._owned(owner_id, round_id)
            now = datetime.now(UTC)
            if (
                row is None
                or row.row_version != expected_version
                or row.status not in {"queued", "paused"}
                or (
                    row.lease_owner not in {None, lease_owner}
                    and row.lease_expires_at is not None
                    and row.lease_expires_at > now
                )
            ):
                return None
            row.lease_owner = lease_owner
            row.lease_expires_at = lease_expires_at
            row.row_version += 1
            row.updated_at = now
            return _copy_row(row)

    async def release_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        expected_version: int,
    ) -> ResearchRoundRow | None:
        async with self._lock:
            row = self._owned(owner_id, round_id)
            if (
                row is None
                or row.row_version != expected_version
                or row.lease_owner != lease_owner
            ):
                return None
            row.lease_owner = None
            row.lease_expires_at = None
            row.row_version += 1
            row.updated_at = datetime.now(UTC)
            return _copy_row(row)

    async def checkpoint(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        checkpoint: RoundCheckpoint,
    ) -> ResearchRoundRow | None:
        async with self._lock:
            row = self._owned(owner_id, round_id)
            if (
                row is None
                or row.row_version != expected_version
                or row.status != checkpoint.status
                or row.lease_owner != checkpoint.lease_owner
            ):
                return None

            respondents = {
                key: _copy_row(value) for key, value in self._respondents.items()
            }
            sessions = {
                key: _copy_row(value) for key, value in self._sessions.items()
            }
            messages = {
                key: _copy_row(value) for key, value in self._messages.items()
            }
            responses = {
                key: _copy_row(value) for key, value in self._responses.items()
            }
            inference = {
                key: _copy_row(value)
                for key, value in self._inference_results.items()
            }
            respondent = checkpoint.respondent
            session = checkpoint.session
            if (
                respondent.id not in respondents
                or respondents[respondent.id].round_id != round_id
                or session.id not in sessions
                or sessions[session.id].round_respondent_id != respondent.id
            ):
                raise RuntimeError("checkpoint target is not part of round")

            message_keys = {
                (value.session_id, value.ordinal) for value in messages.values()
            }
            response_keys = {
                (value.round_respondent_id, value.question_id)
                for value in responses.values()
            }
            inference_keys = {
                (value.round_respondent_id, value.task_id)
                for value in inference.values()
            }
            for value in checkpoint.messages:
                key = (value.session_id, value.ordinal)
                if key in message_keys:
                    raise ValueError("duplicate message ordinal")
                message_keys.add(key)
                messages[value.id] = _copy_row(value)
            for value in checkpoint.responses:
                key = (value.round_respondent_id, value.question_id)
                if key in response_keys:
                    raise ValueError("duplicate response question")
                response_keys.add(key)
                responses[value.id] = _copy_row(value)
            for value in checkpoint.inference_results:
                key = (value.round_respondent_id, value.task_id)
                if key in inference_keys:
                    raise ValueError("duplicate inference task")
                inference_keys.add(key)
                inference[value.id] = _copy_row(value)

            respondents[respondent.id] = _copy_row(respondent)
            sessions[session.id] = _copy_row(session)
            row.active_respondent_id = checkpoint.active_respondent_id
            row.total_respondents = checkpoint.total_respondents
            row.completed_respondents = checkpoint.completed_respondents
            row.terminated_respondents = checkpoint.terminated_respondents
            row.failed_respondents = checkpoint.failed_respondents
            row.incomplete_respondents = checkpoint.incomplete_respondents
            row.pause_requested_at = checkpoint.pause_requested_at
            row.lease_expires_at = checkpoint.lease_expires_at
            row.error_code = checkpoint.error_code
            row.error_message = checkpoint.error_message
            row.row_version += 1
            row.updated_at = datetime.now(UTC)
            self._respondents = respondents
            self._sessions = sessions
            self._messages = messages
            self._responses = responses
            self._inference_results = inference
            return _copy_row(row)

    async def get_result_rows_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID | str,
    ) -> RoundResultRows | None:
        round_id = _uuid(round_id)
        async with self._lock:
            row = self._owned(owner_id, round_id)
            if row is None:
                return None
            respondents = sorted(
                (
                    value
                    for value in self._respondents.values()
                    if value.round_id == round_id
                ),
                key=lambda value: value.ordinal,
            )
            respondent_ids = {value.id for value in respondents}
            sessions = sorted(
                (
                    value
                    for value in self._sessions.values()
                    if value.round_respondent_id in respondent_ids
                ),
                key=lambda value: next(
                    item.ordinal
                    for item in respondents
                    if item.id == value.round_respondent_id
                ),
            )
            session_ids = {value.id for value in sessions}
            messages = sorted(
                (
                    value
                    for value in self._messages.values()
                    if value.session_id in session_ids
                ),
                key=lambda value: (str(value.session_id), value.ordinal),
            )
            responses = sorted(
                (
                    value
                    for value in self._responses.values()
                    if value.round_respondent_id in respondent_ids
                ),
                key=lambda value: (str(value.round_respondent_id), value.created_at),
            )
            inference = sorted(
                (
                    value
                    for value in self._inference_results.values()
                    if value.round_respondent_id in respondent_ids
                ),
                key=lambda value: (str(value.round_respondent_id), value.created_at),
            )
            return RoundResultRows(
                round=_copy_row(row),
                respondents=tuple(_copy_row(value) for value in respondents),
                sessions=tuple(_copy_row(value) for value in sessions),
                messages=tuple(_copy_row(value) for value in messages),
                responses=tuple(_copy_row(value) for value in responses),
                inference_results=tuple(_copy_row(value) for value in inference),
            )

    async def list_retryable_respondents_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
        retry_kind: RetryKind,
    ) -> tuple[RoundRespondentRow, ...]:
        async with self._lock:
            if self._owned(owner_id, round_id) is None:
                return ()
            statuses = (
                {"failed"}
                if retry_kind == "failed"
                else {"pending", "in_progress", "cancelled"}
            )
            rows = sorted(
                (
                    row
                    for row in self._respondents.values()
                    if row.round_id == round_id and row.status in statuses
                ),
                key=lambda row: row.ordinal,
            )
            return tuple(_copy_row(row) for row in rows)

    async def reconcile_interrupted_rounds(
        self,
        stale_before: datetime,
    ) -> tuple[ResearchRoundRow, ...]:
        async with self._lock:
            now = datetime.now(UTC)
            result = []
            for row in sorted(
                self._rounds.values(),
                key=lambda value: (value.created_at, value.id),
            ):
                if row.status not in {"queued", "running", "pausing"}:
                    continue
                if (
                    row.lease_expires_at is not None
                    and row.lease_expires_at > stale_before
                ):
                    continue
                row.status = "paused"
                row.row_version += 1
                row.active_respondent_id = None
                row.pause_requested_at = None
                row.lease_owner = None
                row.lease_expires_at = None
                row.updated_at = now
                row.error_code = "RUN_INTERRUPTED_BY_RESTART"
                row.error_message = "Execution lease expired during restart"
                result.append(_copy_row(row))
            return tuple(result)

    def _owned(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> ResearchRoundRow | None:
        if self._owners.get(round_id) != owner_id:
            return None
        return self._rounds.get(round_id)

    def _cancel_unfinished(self, round_id: UUID, now: datetime) -> None:
        unfinished_ids = set()
        for row in self._respondents.values():
            if row.round_id == round_id and row.status in {
                "pending",
                "in_progress",
            }:
                row.status = "cancelled"
                row.finished_at = now
                unfinished_ids.add(row.id)
        for row in self._sessions.values():
            if row.round_respondent_id in unfinished_ids:
                row.status = "cancelled"
                row.finished_at = now


def _copy_row(row):
    return type(row)(
        **{
            column.name: deepcopy(getattr(row, column.name))
            for column in row.__table__.columns
        }
    )


def _uuid(value: UUID | str) -> UUID:
    return value if isinstance(value, UUID) else UUID(value)
