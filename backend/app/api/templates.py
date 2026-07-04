from fastapi import APIRouter, Depends

from app.api.language import require_language
from app.schemas.survey import SurveyConfig
from app.services.mock_engine import default_survey_config

router = APIRouter(
    prefix="/api/templates",
    tags=["templates"],
    dependencies=[Depends(require_language)],
)


@router.get("/default", response_model=SurveyConfig)
async def get_default_template() -> SurveyConfig:
    return default_survey_config()
