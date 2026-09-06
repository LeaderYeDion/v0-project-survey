from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, status

from app.api.dependencies import get_current_user, require_csrf, research_service
from app.schemas.auth import CurrentUser
from app.schemas.research import (
    CreateProject,
    CreateQuestionnaire,
    ProjectView,
    QuestionnaireView,
    UpdateProject,
)
from app.services.research_service import ResearchService


router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectView])
async def list_projects(
    current_user: CurrentUser = Depends(get_current_user),
    service: ResearchService = Depends(research_service),
) -> list[ProjectView]:
    return await service.list_projects(current_user.id)


@router.post("", response_model=ProjectView, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: CreateProject,
    current_user: CurrentUser = Depends(require_csrf),
    service: ResearchService = Depends(research_service),
) -> ProjectView:
    return await service.create_project(current_user.id, payload)


@router.get("/{project_id}", response_model=ProjectView)
async def get_project(
    project_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ResearchService = Depends(research_service),
) -> ProjectView:
    return await service.get_project(current_user.id, project_id)


@router.patch("/{project_id}", response_model=ProjectView)
async def update_project(
    project_id: UUID,
    payload: UpdateProject,
    current_user: CurrentUser = Depends(require_csrf),
    service: ResearchService = Depends(research_service),
) -> ProjectView:
    return await service.update_project(current_user.id, project_id, payload)


@router.get(
    "/{project_id}/questionnaires",
    response_model=list[QuestionnaireView],
)
async def list_questionnaires(
    project_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ResearchService = Depends(research_service),
) -> list[QuestionnaireView]:
    return await service.list_questionnaires(current_user.id, project_id)


@router.post(
    "/{project_id}/questionnaires",
    response_model=QuestionnaireView,
    status_code=status.HTTP_201_CREATED,
)
async def create_questionnaire(
    project_id: UUID,
    payload: CreateQuestionnaire,
    current_user: CurrentUser = Depends(require_csrf),
    service: ResearchService = Depends(research_service),
) -> QuestionnaireView:
    return await service.create_questionnaire(
        current_user.id,
        project_id,
        payload,
    )
