from __future__ import annotations

import os
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


@dataclass(frozen=True)
class DatabaseSettings:
    url: str

    @classmethod
    def from_env(cls) -> "DatabaseSettings":
        value = os.environ.get("DATABASE_URL", "").strip()
        if not value.startswith("postgresql+asyncpg://"):
            raise RuntimeError("DATABASE_URL must use postgresql+asyncpg")
        return cls(url=value)


def create_session_factory(
    database_url: str,
) -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    return async_sessionmaker(engine, expire_on_commit=False)
