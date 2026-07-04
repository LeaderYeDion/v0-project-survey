from fastapi import APIRouter, Request

from app.api.helpers import (
    history_as_snapshot,
    not_found,
    repository,
    runs,
)
from app.schemas.analytics import AnalyticsQuery, AnalyticsQueryResult

router = APIRouter(tags=["analytics"])


@router.post(
    "/api/runs/{run_id}/analytics/query",
    response_model=AnalyticsQueryResult,
)
async def query_run(
    run_id: str,
    payload: AnalyticsQuery,
    request: Request,
) -> AnalyticsQueryResult:
    run = await runs(request).get(run_id)
    if run is None:
        raise not_found("RUN_NOT_FOUND", "运行记录不存在")
    return request.app.state.analytics.query(run, payload)


@router.post(
    "/api/history/{history_id}/analytics/query",
    response_model=AnalyticsQueryResult,
)
async def query_history(
    history_id: str,
    payload: AnalyticsQuery,
    request: Request,
) -> AnalyticsQueryResult:
    record = await repository(request).get_history(history_id)
    if record is None:
        raise not_found("HISTORY_NOT_FOUND", "历史记录不存在")
    return request.app.state.analytics.query(
        history_as_snapshot(record),
        payload,
    )
