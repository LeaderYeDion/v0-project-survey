from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from app.api.errors import ApiError
from app.db.errors import STORAGE_ERRORS


logger = logging.getLogger(__name__)


class RecoveryService:
    """Reconcile expired work throughout the application's lifetime."""

    def __init__(self, executor, exports, *, interval_seconds: float = 5) -> None:
        self.executor = executor
        self.exports = exports
        self.interval_seconds = interval_seconds
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None:
            return
        await self._reconcile()
        self._task = asyncio.create_task(self._run(), name="research-recovery")

    async def stop(self) -> None:
        if self._task is None:
            return
        task, self._task = self._task, None
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.interval_seconds)
            await self._reconcile()

    async def _reconcile(self) -> None:
        for reconcile in (
            self.executor.reconcile_interrupted_rounds,
            self.exports.recover_stale_exports,
        ):
            try:
                await reconcile()
            except Exception as error:
                storage_failure = isinstance(error, STORAGE_ERRORS) or (
                    isinstance(error, ApiError) and error.code == "STORAGE_UNAVAILABLE"
                )
                logger.warning("%s operation=%s error_type=%s",
                    "STORAGE_UNAVAILABLE" if storage_failure else "RECOVERY_FAILED",
                    reconcile.__name__, type(error).__name__)
