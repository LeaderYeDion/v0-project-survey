from typing import Mapping, Protocol

from app.locales import Locale


class AnalysisLabels(Protocol):
    def dimension_labels(self, locale: Locale) -> Mapping[str, str]: ...
    def income_group_label(self, locale: Locale, value: str) -> str: ...
