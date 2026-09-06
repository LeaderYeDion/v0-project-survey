from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, run_service
from app.api.errors import ApiError
from app.schemas.analytics import AnalyticsQuery, AnalyticsQueryResult
from app.schemas.auth import CurrentUser
from app.services.run_service import RunService


router = APIRouter(tags=["analytics"])


@router.post(
    "/api/rounds/{round_id}/analytics/query",
    response_model=AnalyticsQueryResult,
)
async def query_round(
    round_id: UUID,
    payload: AnalyticsQuery,
    current_user: CurrentUser = Depends(get_current_user),
    service: RunService = Depends(run_service),
) -> AnalyticsQueryResult:
    if await service.repository.get_for_owner(current_user.id, round_id) is None:
        raise _not_found()
    snapshot = await service.get(current_user.id, round_id)
    return service.analytics.query(
        snapshot,
        question_id=payload.questionId,
        filters=payload.filters,
        group_by=payload.groupBy,
    )


def _not_found() -> ApiError:
    return ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
    )
