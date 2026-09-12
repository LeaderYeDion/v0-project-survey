from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.errors import storage_session
from app.db.models import UserRow, UserSessionRow


class AuthRepository:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self._session_factory = session_factory

    async def create_user(
        self,
        username: str,
        password_hash: str,
        locale: str,
    ) -> UserRow:
        row = UserRow(
            username=_normalize_username(username),
            password_hash=password_hash,
            locale=locale,
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                session.add(row)
                await session.flush()
        return row

    async def get_user_by_username(self, username: str) -> UserRow | None:
        statement = select(UserRow).where(
            UserRow.username == _normalize_username(username)
        )
        async with storage_session(self._session_factory) as session:
            return await session.scalar(statement)

    async def get_user(self, user_id: UUID) -> UserRow | None:
        async with storage_session(self._session_factory) as session:
            return await session.get(UserRow, user_id)

    async def create_session(
        self,
        user_id: UUID,
        token_hash: str,
        csrf_token_hash: str,
        expires_at: datetime,
    ) -> UserSessionRow:
        row = UserSessionRow(
            user_id=user_id,
            token_hash=token_hash,
            csrf_token_hash=csrf_token_hash,
            expires_at=expires_at,
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                session.add(row)
                await session.flush()
        return row

    async def get_session_by_token_hash(
        self,
        token_hash: str,
    ) -> UserSessionRow | None:
        statement = select(UserSessionRow).where(
            UserSessionRow.token_hash == token_hash
        )
        async with storage_session(self._session_factory) as session:
            return await session.scalar(statement)

    async def revoke_session(self, token_hash: str) -> None:
        statement = (
            update(UserSessionRow)
            .where(
                UserSessionRow.token_hash == token_hash,
                UserSessionRow.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                await session.execute(statement)

    async def update_password_hash(
        self,
        username: str,
        password_hash: str,
    ) -> bool:
        statement = (
            update(UserRow)
            .where(UserRow.username == _normalize_username(username))
            .values(password_hash=password_hash, updated_at=datetime.now(UTC))
        )
        async with storage_session(self._session_factory) as session:
            async with session.begin():
                result = await session.execute(statement)
        return bool(result.rowcount)


def _normalize_username(username: str) -> str:
    return username.strip().casefold()
