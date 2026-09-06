from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user, require_csrf, research_service
from app.schemas.auth import CurrentUser
from app.schemas.research import (
    QuestionnaireVersionView,
    QuestionnaireView,
    SaveDraft,
)
from app.services.research_service import ResearchService


router = APIRouter(prefix="/api/questionnaires", tags=["questionnaires"])


@router.get("/{questionnaire_id}", response_model=QuestionnaireView)
async def get_questionnaire(
    questionnaire_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ResearchService = Depends(research_service),
) -> QuestionnaireView:
    return await service.get_questionnaire(current_user.id, questionnaire_id)


@router.patch("/{questionnaire_id}", response_model=QuestionnaireView)
async def save_questionnaire_draft(
    questionnaire_id: UUID,
    payload: SaveDraft,
    current_user: CurrentUser = Depends(require_csrf),
    service: ResearchService = Depends(research_service),
) -> QuestionnaireView:
    return await service.save_draft(
        current_user.id,
        questionnaire_id,
        payload.config,
        payload.expected_revision,
    )


@router.get(
    "/{questionnaire_id}/versions",
    response_model=list[QuestionnaireVersionView],
)
async def list_questionnaire_versions(
    questionnaire_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ResearchService = Depends(research_service),
) -> list[QuestionnaireVersionView]:
    return await service.list_questionnaire_versions(
        current_user.id,
        questionnaire_id,
    )
