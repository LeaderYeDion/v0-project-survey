from pathlib import Path


def test_generic_services_do_not_depend_on_mock_implementation() -> None:
    backend = Path(__file__).parents[1]
    run_service = (backend / "app/services/run_service.py").read_text()
    analytics = (backend / "app/services/analytics_service.py").read_text()
    templates = (backend / "app/api/templates.py").read_text()

    for source in (run_service, analytics, templates):
        assert "app.mocks" not in source
    assert ".rng" not in run_service
    assert "受访者" not in run_service
