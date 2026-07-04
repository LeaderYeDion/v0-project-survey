from fastapi import APIRouter, Request

from app.api.helpers import not_found, repository, runs
from app.schemas.survey import (
    CreateHistoryRequest,
    SurveyHistoryRecord,
)

router = APIRouter(prefix="/api/history", tags=["history"])


@router.post("", response_model=SurveyHistoryRecord, status_code=201)
async def save_history(
    payload: CreateHistoryRequest,
    request: Request,
) -> SurveyHistoryRecord:
    run = await runs(request).get(payload.runId)
    if run is None:
        raise not_found("RUN_NOT_FOUND", "运行记录不存在")
    return await repository(request).save_history(run)


@router.get("", response_model=list[SurveyHistoryRecord])
async def list_history(request: Request) -> list[SurveyHistoryRecord]:
    return await repository(request).list_history()


@router.get("/{history_id}", response_model=SurveyHistoryRecord)
async def get_history(
    history_id: str,
    request: Request,
) -> SurveyHistoryRecord:
    value = await repository(request).get_history(history_id)
    if value is None:
        raise not_found("HISTORY_NOT_FOUND", "历史记录不存在")
    return value
