from fastapi import APIRouter, Depends, Request

from app.api.language import require_language
from app.schemas.survey import SurveyConfig

router = APIRouter(
    prefix="/api/templates",
    tags=["templates"],
    dependencies=[Depends(require_language)],
)


@router.get("/default", response_model=SurveyConfig)
async def get_default_template(request: Request) -> SurveyConfig:
    return request.app.state.template_provider.default_template(
        request.state.locale
    )
