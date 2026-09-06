from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.api.dependencies import export_service, get_current_user, require_csrf
from app.schemas.auth import CurrentUser
from app.schemas.exports import ExportRecord, ExportRequest
from app.services.export_service import ExportService


router = APIRouter(tags=["exports"])


@router.post("/api/rounds/{round_id}/exports")
async def generate_export(
    round_id: UUID,
    payload: ExportRequest,
    current_user: CurrentUser = Depends(require_csrf),
    service: ExportService = Depends(export_service),
) -> Response:
    generated = await service.generate(current_user.id, round_id, payload)
    return Response(
        content=generated.content,
        media_type=generated.media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{generated.filename}"'
            ),
            "Content-Language": current_user.locale,
            "X-Export-Record-Id": generated.record_id,
        },
    )


@router.get(
    "/api/rounds/{round_id}/exports",
    response_model=list[ExportRecord],
)
async def list_exports(
    round_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ExportService = Depends(export_service),
) -> list[ExportRecord]:
    return await service.list(current_user.id, round_id)
