from __future__ import annotations

import logging
from contextlib import asynccontextmanager, suppress

from asyncpg import InterfaceError, PostgresError
from sqlalchemy.exc import SQLAlchemyError

from app.api.errors import ApiError


STORAGE_ERRORS = (SQLAlchemyError, PostgresError, InterfaceError, OSError)
logger = logging.getLogger(__name__)


def storage_unavailable() -> ApiError:
    return ApiError(503, "STORAGE_UNAVAILABLE", "Storage is temporarily unavailable. Please retry.")


@asynccontextmanager
async def storage_session(factory):
    """Close/rollback a failed unit of work without exposing SQL or parameters."""
    try:
        async with factory() as session:
            try:
                yield session
            except STORAGE_ERRORS:
                with suppress(*STORAGE_ERRORS):
                    await session.rollback()
                raise
    except STORAGE_ERRORS as error:
        logger.warning("STORAGE_UNAVAILABLE error_type=%s", type(error).__name__)
        raise storage_unavailable() from None
