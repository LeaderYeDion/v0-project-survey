from typing import Protocol

from app.locales import Locale
from app.schemas.survey import SurveyConfig


class TemplateProvider(Protocol):
    def default_template(self, locale: Locale) -> SurveyConfig: ...
