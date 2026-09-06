from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, require_csrf, run_service
from app.schemas.auth import CurrentUser
from app.schemas.research import QuestionnaireView
from app.schemas.rounds import RetryRoundRequest, RoundSnapshot
from app.services.run_service import RunService


router = APIRouter(tags=["rounds"])


@router.post(
    "/api/questionnaires/{questionnaire_id}/rounds",
    response_model=RoundSnapshot,
    status_code=201,
)
async def create_round(
    questionnaire_id: UUID,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.create(
        current_user.id,
        questionnaire_id,
        current_user.locale,
    )


@router.get(
    "/api/projects/{project_id}/rounds",
    response_model=list[RoundSnapshot],
)
async def list_rounds(
    project_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: RunService = Depends(run_service),
) -> list[RoundSnapshot]:
    return await service.list_for_project(current_user.id, project_id)


@router.get("/api/rounds/{round_id}", response_model=RoundSnapshot)
async def get_round(
    round_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.get(current_user.id, round_id)


@router.post("/api/rounds/{round_id}/pause", response_model=RoundSnapshot)
async def pause_round(
    round_id: UUID,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.pause(current_user.id, round_id)


@router.post("/api/rounds/{round_id}/resume", response_model=RoundSnapshot)
async def resume_round(
    round_id: UUID,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.resume(current_user.id, round_id)


@router.post("/api/rounds/{round_id}/cancel", response_model=RoundSnapshot)
async def cancel_round(
    round_id: UUID,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.cancel(current_user.id, round_id)


@router.post(
    "/api/rounds/{round_id}/copy",
    response_model=QuestionnaireView,
    status_code=201,
)
async def copy_round(
    round_id: UUID,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> QuestionnaireView:
    return await service.copy(current_user.id, round_id)


@router.post(
    "/api/rounds/{round_id}/retry",
    response_model=RoundSnapshot,
    status_code=201,
)
async def retry_round(
    round_id: UUID,
    payload: RetryRoundRequest,
    current_user: CurrentUser = Depends(require_csrf),
    service: RunService = Depends(run_service),
) -> RoundSnapshot:
    return await service.retry(current_user.id, round_id, payload.kind)
