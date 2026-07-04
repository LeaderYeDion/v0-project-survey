from typing import Literal

from fastapi import APIRouter, Request, Response

from app.api.helpers import not_found, repository, runs

router = APIRouter(tags=["exports"])


def file_response(
    request: Request,
    value,
    format: Literal["json", "csv"],
) -> Response:
    exporter = request.app.state.exporter
    content = (
        exporter.json_bytes(value)
        if format == "json"
        else exporter.csv_bytes(value)
    )
    return Response(
        content=content,
        media_type=(
            "application/json"
            if format == "json"
            else "text/csv; charset=utf-8"
        ),
        headers={
            "Content-Disposition": (
                f'attachment; filename="survey-results.{format}"'
            )
        },
    )


@router.get("/api/runs/{run_id}/exports")
async def export_run(
    run_id: str,
    format: Literal["json", "csv"],
    request: Request,
) -> Response:
    run = await runs(request).get(run_id)
    if run is None:
        raise not_found("RUN_NOT_FOUND", "运行记录不存在")
    return file_response(request, run, format)


@router.get("/api/history/{history_id}/exports")
async def export_history(
    history_id: str,
    format: Literal["json", "csv"],
    request: Request,
) -> Response:
    record = await repository(request).get_history(history_id)
    if record is None:
        raise not_found("HISTORY_NOT_FOUND", "历史记录不存在")
    return file_response(request, record, format)
