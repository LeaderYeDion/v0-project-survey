from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.errors import storage_session
from app.db.models import (
    ConfigVersionRow,
    InferenceResultRow,
    MessageRow,
    ProjectRow,
    QuestionnaireRow,
    QuestionnaireVersionRow,
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


ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "queued": frozenset({"running", "cancelled", "failed", "paused"}),
    "running": frozenset(
        {
            "pausing",
            "completed",
            "completed_with_errors",
            "cancelled",
            "failed",
            "paused",
        }
    ),
    "pausing": frozenset({"paused", "cancelled", "failed"}),
    "paused": frozenset({"running", "cancelled"}),
    "completed": frozenset(),
    "completed_with_errors": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}


class RoundRepository:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self._session_factory = session_factory

    async def create_round(
        self,
        owner_id: UUID,
        payload: Mapping[str, Any],
    ) -> ResearchRoundRow:
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                owned = await session.scalar(
                    select(QuestionnaireRow.id)
                    .join(ProjectRow, ProjectRow.id == QuestionnaireRow.project_id)
                    .join(
                        QuestionnaireVersionRow,
                        QuestionnaireVersionRow.questionnaire_id
                        == QuestionnaireRow.id,
                    )
                    .join(
                        ConfigVersionRow,
                        ConfigVersionRow.questionnaire_version_id
                        == QuestionnaireVersionRow.id,
                    )
                    .where(
                        QuestionnaireRow.id == payload["questionnaire_id"],
                        QuestionnaireRow.project_id == payload["project_id"],
                        ConfigVersionRow.id == payload["config_version_id"],
                        ProjectRow.owner_user_id == owner_id,
                    )
                )
                if owned is None:
                    raise KeyError(payload["questionnaire_id"])

                now = datetime.now(UTC)
                respondents = list(payload.get("respondents", ()))
                row = ResearchRoundRow(
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
                session.add(row)
                await session.flush()
                for ordinal, item in enumerate(respondents):
                    respondent = RoundRespondentRow(
                        round_id=row.id,
                        source_respondent_id=item.get("source_respondent_id"),
                        ordinal=ordinal,
                        profile_json=dict(item["profile_json"]),
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
                    session.add(respondent)
                    await session.flush()
                    session.add(
                        SessionRow(
                            round_respondent_id=respondent.id,
                            status="pending",
                            started_at=None,
                            finished_at=None,
                            termination_code=None,
                            termination_reason=None,
                            error_code=None,
                            error_message=None,
                        )
                    )
                await session.flush()
                return row

    async def get_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> ResearchRoundRow | None:
        statement = (
            select(ResearchRoundRow)
            .join(ProjectRow, ProjectRow.id == ResearchRoundRow.project_id)
            .where(
                ResearchRoundRow.id == round_id,
                ProjectRow.owner_user_id == owner_id,
            )
        )
        async with storage_session(self._session_factory) as session:
            return await session.scalar(statement)

    async def get_owner_id(self, round_id: UUID) -> UUID | None:
        statement = (
            select(ProjectRow.owner_user_id)
            .join(ResearchRoundRow, ResearchRoundRow.project_id == ProjectRow.id)
            .where(ResearchRoundRow.id == round_id)
        )
        async with storage_session(self._session_factory) as session:
            return await session.scalar(statement)

    async def list_rounds_for_owner(
        self,
        owner_id: UUID,
        questionnaire_id: UUID | None = None,
    ) -> Sequence[ResearchRoundRow]:
        statement = (
            select(ResearchRoundRow)
            .join(ProjectRow, ProjectRow.id == ResearchRoundRow.project_id)
            .where(ProjectRow.owner_user_id == owner_id)
        )
        if questionnaire_id is not None:
            statement = statement.where(
                ResearchRoundRow.questionnaire_id == questionnaire_id
            )
        statement = statement.order_by(
            desc(ResearchRoundRow.created_at),
            desc(ResearchRoundRow.id),
        )
        async with storage_session(self._session_factory) as session:
            return tuple((await session.scalars(statement)).all())

    async def transition(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        from_statuses: frozenset[str],
        to_status: str,
    ) -> ResearchRoundRow | None:
        valid_from_statuses = frozenset(
            status
            for status in from_statuses
            if to_status in ALLOWED_TRANSITIONS.get(status, ())
        )
        if not valid_from_statuses:
            return None
        now = datetime.now(UTC)
        values: dict[str, Any] = {
            "status": to_status,
            "row_version": ResearchRoundRow.row_version + 1,
            "updated_at": now,
        }
        if to_status == "pausing":
            values["pause_requested_at"] = now
        if to_status == "running":
            values.update(
                pause_requested_at=None,
                error_code=None,
                error_message=None,
            )
        if to_status in {
            "paused",
            "completed",
            "completed_with_errors",
            "failed",
            "cancelled",
        }:
            values.update(
                active_respondent_id=None,
                lease_owner=None,
                lease_expires_at=None,
            )
        if to_status in {
            "completed",
            "completed_with_errors",
            "failed",
            "cancelled",
        }:
            values["finished_at"] = now
        if to_status == "running":
            values["started_at"] = func.coalesce(
                ResearchRoundRow.started_at,
                now,
            )

        statement = (
            update(ResearchRoundRow)
            .where(
                ResearchRoundRow.id == round_id,
                ResearchRoundRow.project_id.in_(_owned_projects(owner_id)),
                ResearchRoundRow.row_version == expected_version,
                ResearchRoundRow.status.in_(valid_from_statuses),
            )
            .values(**values)
            .returning(ResearchRoundRow)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                row = await session.scalar(statement)
                if row is None:
                    return None
                if to_status == "cancelled":
                    await _cancel_unfinished(session, round_id, now)
                return row

    async def acquire_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        lease_expires_at: datetime,
        expected_version: int,
    ) -> ResearchRoundRow | None:
        now = datetime.now(UTC)
        statement = (
            update(ResearchRoundRow)
            .where(
                ResearchRoundRow.id == round_id,
                ResearchRoundRow.project_id.in_(_owned_projects(owner_id)),
                ResearchRoundRow.row_version == expected_version,
                ResearchRoundRow.status.in_(("queued", "paused")),
                or_(
                    ResearchRoundRow.lease_owner.is_(None),
                    ResearchRoundRow.lease_expires_at <= now,
                    ResearchRoundRow.lease_owner == lease_owner,
                ),
            )
            .values(
                lease_owner=lease_owner,
                lease_expires_at=lease_expires_at,
                row_version=ResearchRoundRow.row_version + 1,
                updated_at=now,
            )
            .returning(ResearchRoundRow)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                return await session.scalar(statement)

    async def release_lease(
        self,
        owner_id: UUID,
        round_id: UUID,
        lease_owner: str,
        expected_version: int,
    ) -> ResearchRoundRow | None:
        statement = (
            update(ResearchRoundRow)
            .where(
                ResearchRoundRow.id == round_id,
                ResearchRoundRow.project_id.in_(_owned_projects(owner_id)),
                ResearchRoundRow.row_version == expected_version,
                ResearchRoundRow.lease_owner == lease_owner,
            )
            .values(
                lease_owner=None,
                lease_expires_at=None,
                row_version=ResearchRoundRow.row_version + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(ResearchRoundRow)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                return await session.scalar(statement)

    async def checkpoint(
        self,
        owner_id: UUID,
        round_id: UUID,
        expected_version: int,
        checkpoint: RoundCheckpoint,
    ) -> ResearchRoundRow | None:
        now = datetime.now(UTC)
        statement = (
            update(ResearchRoundRow)
            .where(
                ResearchRoundRow.id == round_id,
                ResearchRoundRow.project_id.in_(_owned_projects(owner_id)),
                ResearchRoundRow.row_version == expected_version,
                ResearchRoundRow.status == checkpoint.status,
                ResearchRoundRow.lease_owner == checkpoint.lease_owner,
            )
            .values(
                active_respondent_id=checkpoint.active_respondent_id,
                total_respondents=checkpoint.total_respondents,
                completed_respondents=checkpoint.completed_respondents,
                terminated_respondents=checkpoint.terminated_respondents,
                failed_respondents=checkpoint.failed_respondents,
                incomplete_respondents=checkpoint.incomplete_respondents,
                pause_requested_at=checkpoint.pause_requested_at,
                lease_expires_at=checkpoint.lease_expires_at,
                error_code=checkpoint.error_code,
                error_message=checkpoint.error_message,
                row_version=ResearchRoundRow.row_version + 1,
                updated_at=now,
            )
            .returning(ResearchRoundRow)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                round_row = await session.scalar(statement)
                if round_row is None:
                    return None
                respondent = checkpoint.respondent
                respondent_updated = await session.scalar(
                    update(RoundRespondentRow)
                    .where(
                        RoundRespondentRow.id == respondent.id,
                        RoundRespondentRow.round_id == round_id,
                    )
                    .values(**_respondent_values(respondent))
                    .returning(RoundRespondentRow.id)
                )
                session_row = checkpoint.session
                session_updated = await session.scalar(
                    update(SessionRow)
                    .where(
                        SessionRow.id == session_row.id,
                        SessionRow.round_respondent_id == respondent.id,
                    )
                    .values(**_session_values(session_row))
                    .returning(SessionRow.id)
                )
                if respondent_updated is None or session_updated is None:
                    raise RuntimeError("checkpoint target is not part of round")
                session.add_all(
                    [
                        *checkpoint.messages,
                        *checkpoint.responses,
                        *checkpoint.inference_results,
                    ]
                )
                await session.flush()
                return round_row

    async def get_result_rows_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> RoundResultRows | None:
        async with storage_session(self._session_factory) as session:
            round_row = await session.scalar(
                select(ResearchRoundRow)
                .join(ProjectRow, ProjectRow.id == ResearchRoundRow.project_id)
                .where(
                    ResearchRoundRow.id == round_id,
                    ProjectRow.owner_user_id == owner_id,
                )
            )
            if round_row is None:
                return None
            respondents = tuple(
                (
                    await session.scalars(
                        select(RoundRespondentRow)
                        .where(RoundRespondentRow.round_id == round_id)
                        .order_by(RoundRespondentRow.ordinal)
                    )
                ).all()
            )
            respondent_ids = [row.id for row in respondents]
            sessions = tuple(
                (
                    await session.scalars(
                        select(SessionRow)
                        .join(
                            RoundRespondentRow,
                            RoundRespondentRow.id
                            == SessionRow.round_respondent_id,
                        )
                        .where(SessionRow.round_respondent_id.in_(respondent_ids))
                        .order_by(RoundRespondentRow.ordinal)
                    )
                ).all()
            )
            session_ids = [row.id for row in sessions]
            messages = tuple(
                (
                    await session.scalars(
                        select(MessageRow)
                        .join(SessionRow, SessionRow.id == MessageRow.session_id)
                        .join(
                            RoundRespondentRow,
                            RoundRespondentRow.id
                            == SessionRow.round_respondent_id,
                        )
                        .where(MessageRow.session_id.in_(session_ids))
                        .order_by(
                            RoundRespondentRow.ordinal,
                            MessageRow.ordinal,
                        )
                    )
                ).all()
            )
            responses = tuple(
                (
                    await session.scalars(
                        select(ResponseRow)
                        .join(
                            RoundRespondentRow,
                            RoundRespondentRow.id
                            == ResponseRow.round_respondent_id,
                        )
                        .where(
                            ResponseRow.round_respondent_id.in_(respondent_ids)
                        )
                        .order_by(
                            RoundRespondentRow.ordinal,
                            ResponseRow.created_at,
                        )
                    )
                ).all()
            )
            inference_results = tuple(
                (
                    await session.scalars(
                        select(InferenceResultRow)
                        .join(
                            RoundRespondentRow,
                            RoundRespondentRow.id
                            == InferenceResultRow.round_respondent_id,
                        )
                        .where(
                            InferenceResultRow.round_respondent_id.in_(
                                respondent_ids
                            )
                        )
                        .order_by(
                            RoundRespondentRow.ordinal,
                            InferenceResultRow.created_at,
                        )
                    )
                ).all()
            )
            return RoundResultRows(
                round=round_row,
                respondents=respondents,
                sessions=sessions,
                messages=messages,
                responses=responses,
                inference_results=inference_results,
            )

    async def list_retryable_respondents_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
        retry_kind: RetryKind,
    ) -> Sequence[RoundRespondentRow]:
        statuses = (
            ("failed",)
            if retry_kind == "failed"
            else ("pending", "in_progress", "cancelled")
        )
        statement = (
            select(RoundRespondentRow)
            .join(
                ResearchRoundRow,
                ResearchRoundRow.id == RoundRespondentRow.round_id,
            )
            .join(ProjectRow, ProjectRow.id == ResearchRoundRow.project_id)
            .where(
                RoundRespondentRow.round_id == round_id,
                RoundRespondentRow.status.in_(statuses),
                ProjectRow.owner_user_id == owner_id,
            )
            .order_by(RoundRespondentRow.ordinal)
        )
        async with storage_session(self._session_factory) as session:
            return tuple((await session.scalars(statement)).all())

    async def reconcile_interrupted_rounds(
        self,
        stale_before: datetime,
    ) -> Sequence[ResearchRoundRow]:
        now = datetime.now(UTC)
        statement = (
            select(ResearchRoundRow)
            .where(
                ResearchRoundRow.status.in_(("queued", "running", "pausing")),
                or_(
                    ResearchRoundRow.lease_expires_at.is_(None),
                    ResearchRoundRow.lease_expires_at <= stale_before,
                ),
            )
            .order_by(ResearchRoundRow.created_at, ResearchRoundRow.id)
            .with_for_update(skip_locked=True)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                rows = tuple((await session.scalars(statement)).all())
                for row in rows:
                    row.status = "paused"
                    row.row_version += 1
                    row.active_respondent_id = None
                    row.pause_requested_at = None
                    row.lease_owner = None
                    row.lease_expires_at = None
                    row.updated_at = now
                    row.error_code = "RUN_INTERRUPTED_BY_RESTART"
                    row.error_message = "Execution lease expired during restart"
                await session.flush()
                return rows


def _owned_projects(owner_id: UUID):
    return select(ProjectRow.id).where(ProjectRow.owner_user_id == owner_id)


async def _cancel_unfinished(
    session: AsyncSession,
    round_id: UUID,
    now: datetime,
) -> None:
    respondent_ids = select(RoundRespondentRow.id).where(
        RoundRespondentRow.round_id == round_id,
        RoundRespondentRow.status.in_(("pending", "in_progress")),
    )
    await session.execute(
        update(SessionRow)
        .where(SessionRow.round_respondent_id.in_(respondent_ids))
        .values(status="cancelled", finished_at=now)
    )
    await session.execute(
        update(RoundRespondentRow)
        .where(
            RoundRespondentRow.round_id == round_id,
            RoundRespondentRow.status.in_(("pending", "in_progress")),
        )
        .values(status="cancelled", finished_at=now)
    )


def _respondent_values(row: RoundRespondentRow) -> dict[str, Any]:
    return {
        "status": row.status,
        "completed_questions": row.completed_questions,
        "termination_code": row.termination_code,
        "termination_reason": row.termination_reason,
        "error_code": row.error_code,
        "error_message": row.error_message,
        "started_at": row.started_at,
        "finished_at": row.finished_at,
    }


def _session_values(row: SessionRow) -> dict[str, Any]:
    return {
        "status": row.status,
        "started_at": row.started_at,
        "finished_at": row.finished_at,
        "termination_code": row.termination_code,
        "termination_reason": row.termination_reason,
        "error_code": row.error_code,
        "error_message": row.error_message,
    }
