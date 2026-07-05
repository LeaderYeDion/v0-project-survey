from app.mocks.catalog import MockCatalog


def test_default_templates_have_parallel_contracts() -> None:
    catalog = MockCatalog()
    zh = catalog.default_template("zh-CN")
    en = catalog.default_template("en-US")

    assert zh.title == "用户体验调研"
    assert en.title == "User Experience Survey"
    assert [item.id for item in zh.questions] == [item.id for item in en.questions]
    assert [item.type for item in zh.questions] == [item.type for item in en.questions]
    assert zh.questions[1].options == ["搜索功能", "推荐系统", "个人中心", "社交分享"]
    assert en.questions[1].options == [
        "Search",
        "Recommendations",
        "Profile",
        "Social sharing",
    ]


def test_catalogs_expose_localized_profile_and_analysis_data() -> None:
    catalog = MockCatalog()
    zh = catalog.data("zh-CN")
    en = catalog.data("en-US")

    assert zh.dimension_labels["gender"] == "性别"
    assert en.dimension_labels["gender"] == "Gender"
    assert zh.male_names and en.male_names
    assert zh.termination_phrases and en.termination_phrases
    assert zh.low_quality_termination_reason != en.low_quality_termination_reason
