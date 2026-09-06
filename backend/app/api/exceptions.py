from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, run_service
from app.api.errors import ApiError
from app.schemas.analytics import ExceptionReport
from app.schemas.auth import CurrentUser
from app.services.run_service import RunService


router = APIRouter(tags=["exceptions"])


@router.get(
    "/api/rounds/{round_id}/exceptions",
    response_model=ExceptionReport,
)
async def get_exceptions(
    round_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: RunService = Depends(run_service),
) -> ExceptionReport:
    if await service.repository.get_for_owner(current_user.id, round_id) is None:
        raise _not_found()
    snapshot = await service.get(current_user.id, round_id)
    return service.exception_service.report(snapshot)


def _not_found() -> ApiError:
    return ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
    )
