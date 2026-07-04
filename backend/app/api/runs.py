from fastapi import APIRouter, Request

from app.api.helpers import not_found, runs
from app.schemas.survey import CreateRunRequest, RunSnapshot

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=RunSnapshot, status_code=201)
async def create_run(
    payload: CreateRunRequest,
    request: Request,
) -> RunSnapshot:
    return await runs(request).create_run(payload)


@router.get("/{run_id}", response_model=RunSnapshot)
async def get_run(run_id: str, request: Request) -> RunSnapshot:
    value = await runs(request).get(run_id)
    if value is None:
        raise not_found("RUN_NOT_FOUND", "运行记录不存在")
    return value


@router.post("/{run_id}/cancel", response_model=RunSnapshot)
async def cancel_run(run_id: str, request: Request) -> RunSnapshot:
    value = await runs(request).cancel(run_id)
    if value is None:
        raise not_found("RUN_NOT_FOUND", "运行记录不存在")
    return value
