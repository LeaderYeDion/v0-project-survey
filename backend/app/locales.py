from typing import Literal

Locale = Literal["zh-CN", "en-US"]


def normalize_locale(accept_language: str | None) -> Locale:
    return "zh-CN" if accept_language == "zh-CN" else "en-US"
