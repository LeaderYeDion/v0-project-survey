from app.locales import normalize_locale


def test_only_exact_chinese_header_selects_chinese() -> None:
    assert normalize_locale("zh-CN") == "zh-CN"
    assert normalize_locale("en-US") == "en-US"
    assert normalize_locale(None) == "en-US"
    assert normalize_locale("fr-FR") == "en-US"
    assert normalize_locale("zh-cn") == "en-US"
    assert normalize_locale("zh-CN,zh;q=0.9") == "en-US"
