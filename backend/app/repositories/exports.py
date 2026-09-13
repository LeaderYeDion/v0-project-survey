from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.errors import storage_session
from app.db.models import ExportRecordRow, ProjectRow, ResearchRoundRow
from app.repositories.protocols import RoundRepositoryProtocol


class ExportRepository:
    """Export records with a transaction boundary around every state change."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        round_repository: RoundRepositoryProtocol | None = None,
    ) -> None:
        if session_factory is None and round_repository is None:
            raise ValueError("round_repository is required for in-memory exports")
        self._session_factory = session_factory
        self._round_repository = round_repository
        self._records: dict[UUID, ExportRecordRow] = {}
        self._lock = asyncio.Lock()

    async def create_export(
        self,
        owner_id: UUID,
        round_id: UUID,
        payload: Mapping[str, Any],
    ) -> ExportRecordRow | None:
        if self._session_factory is None:
            return await self._create_in_memory(owner_id, round_id, payload)
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                owned = await session.scalar(
                    select(ResearchRoundRow.id)
                    .join(
                        ProjectRow,
                        ProjectRow.id == ResearchRoundRow.project_id,
                    )
                    .where(
                        ResearchRoundRow.id == round_id,
                        ProjectRow.owner_user_id == owner_id,
                    )
                )
                if owned is None:
                    return None
                row = ExportRecordRow(
                    round_id=round_id,
                    requested_by_user_id=owner_id,
                    format=payload["format"],
                    scope=payload["scope"],
                    filters_json=dict(payload["filters_json"]),
                    filename=payload["filename"],
                    status="processing",
                    created_at=datetime.now(UTC),
                    finished_at=None,
                    error_code=None,
                    error_message=None,
                )
                session.add(row)
                await session.flush()
                return row

    async def list_exports_for_owner(
        self,
        owner_id: UUID,
        round_id: UUID,
    ) -> Sequence[ExportRecordRow]:
        if self._session_factory is None:
            assert self._round_repository is not None
            owned = await self._round_repository.get_for_owner(
                owner_id,
                round_id,
            )
            if owned is None:
                return ()
            async with self._lock:
                rows = [
                    _copy_row(row)
                    for row in self._records.values()
                    if row.round_id == round_id
                    and row.requested_by_user_id == owner_id
                ]
            rows.sort(key=lambda row: (row.created_at, row.id), reverse=True)
            return tuple(rows)
        statement = (
            select(ExportRecordRow)
            .join(
                ResearchRoundRow,
                ResearchRoundRow.id == ExportRecordRow.round_id,
            )
            .join(ProjectRow, ProjectRow.id == ResearchRoundRow.project_id)
            .where(
                ExportRecordRow.round_id == round_id,
                ExportRecordRow.requested_by_user_id == owner_id,
                ProjectRow.owner_user_id == owner_id,
            )
            .order_by(desc(ExportRecordRow.created_at), desc(ExportRecordRow.id))
        )
        async with storage_session(self._session_factory) as session:
            return tuple((await session.scalars(statement)).all())

    async def mark_succeeded(
        self,
        owner_id: UUID,
        export_id: UUID,
        filename: str,
        finished_at: datetime,
    ) -> ExportRecordRow | None:
        return await self._finish(
            owner_id,
            export_id,
            {
                "filename": filename,
                "status": "succeeded",
                "finished_at": finished_at,
                "error_code": None,
                "error_message": None,
            },
        )

    async def fail_stale_processing(self, stale_before: datetime, finished_at: datetime):
        values = {
            "status": "failed", "finished_at": finished_at,
            "error_code": "EXPORT_GENERATION_INTERRUPTED",
            "error_message": "Export generation was interrupted. Please retry.",
        }
        if self._session_factory is None:
            async with self._lock:
                stale = [row for row in self._records.values() if row.status == "processing" and row.created_at <= stale_before]
                for row in stale:
                    for name, value in values.items():
                        setattr(row, name, value)
                return tuple(_copy_row(row) for row in stale)
        statement = (update(ExportRecordRow)
            .where(ExportRecordRow.status == "processing", ExportRecordRow.created_at <= stale_before)
            .values(**values).returning(ExportRecordRow))
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                return tuple((await session.scalars(statement)).all())

    async def mark_failed(
        self,
        owner_id: UUID,
        export_id: UUID,
        error_code: str,
        error_message: str,
        finished_at: datetime,
    ) -> ExportRecordRow | None:
        return await self._finish(
            owner_id,
            export_id,
            {
                "status": "failed",
                "finished_at": finished_at,
                "error_code": error_code,
                "error_message": error_message,
            },
        )

    async def _create_in_memory(
        self,
        owner_id: UUID,
        round_id: UUID,
        payload: Mapping[str, Any],
    ) -> ExportRecordRow | None:
        assert self._round_repository is not None
        owned = await self._round_repository.get_for_owner(owner_id, round_id)
        if owned is None:
            return None
        row = ExportRecordRow(
            id=uuid4(),
            round_id=round_id,
            requested_by_user_id=owner_id,
            format=payload["format"],
            scope=payload["scope"],
            filters_json=deepcopy(dict(payload["filters_json"])),
            filename=payload["filename"],
            status="processing",
            created_at=datetime.now(UTC),
            finished_at=None,
            error_code=None,
            error_message=None,
        )
        async with self._lock:
            self._records[row.id] = row
            return _copy_row(row)

    async def _finish(
        self,
        owner_id: UUID,
        export_id: UUID,
        values: Mapping[str, Any],
    ) -> ExportRecordRow | None:
        if self._session_factory is None:
            async with self._lock:
                row = self._records.get(export_id)
                if row is None or row.requested_by_user_id != owner_id:
                    return None
                if row.status != "processing":
                    return None
                for name, value in values.items():
                    setattr(row, name, value)
                return _copy_row(row)
        statement = (
            update(ExportRecordRow)
            .where(
                ExportRecordRow.id == export_id,
                ExportRecordRow.requested_by_user_id == owner_id,
                ExportRecordRow.status == "processing",
            )
            .values(**values)
            .returning(ExportRecordRow)
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                return await session.scalar(statement)


def _copy_row(row: ExportRecordRow) -> ExportRecordRow:
    return ExportRecordRow(
        **{
            column.name: deepcopy(getattr(row, column.name))
            for column in row.__table__.columns
        }
    )
