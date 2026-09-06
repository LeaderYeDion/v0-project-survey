from inspect import signature
from typing import get_protocol_members

from app.repositories.protocols import (
    ResearchRepositoryProtocol,
    RoundRepositoryProtocol,
)


def test_research_protocol_supports_owned_listing_and_version_freezing() -> None:
    expected_parameters = {
        "list_questionnaires_for_owner": (
            "self",
            "owner_id",
            "project_id",
        ),
        "freeze_versions": (
            "self",
            "owner_id",
            "questionnaire_id",
            "payload",
        ),
        "list_questionnaire_versions_for_owner": (
            "self",
            "owner_id",
            "questionnaire_id",
        ),
        "list_config_versions_for_owner": (
            "self",
            "owner_id",
            "project_id",
        ),
    }

    assert expected_parameters.keys() <= get_protocol_members(
        ResearchRepositoryProtocol
    )
    for method_name, parameters in expected_parameters.items():
        method = getattr(ResearchRepositoryProtocol, method_name)
        assert tuple(signature(method).parameters) == parameters


def test_round_protocol_supports_checkpointed_owned_result_access() -> None:
    expected_parameters = {
        "acquire_lease": (
            "self",
            "owner_id",
            "round_id",
            "lease_owner",
            "lease_expires_at",
            "expected_version",
        ),
        "release_lease": (
            "self",
            "owner_id",
            "round_id",
            "lease_owner",
            "expected_version",
        ),
        "checkpoint": (
            "self",
            "owner_id",
            "round_id",
            "expected_version",
            "checkpoint",
        ),
        "get_result_rows_for_owner": (
            "self",
            "owner_id",
            "round_id",
        ),
        "list_retryable_respondents_for_owner": (
            "self",
            "owner_id",
            "round_id",
            "retry_kind",
        ),
        "reconcile_interrupted_rounds": (
            "self",
            "stale_before",
        ),
    }

    assert expected_parameters.keys() <= get_protocol_members(
        RoundRepositoryProtocol
    )
    for method_name, parameters in expected_parameters.items():
        method = getattr(RoundRepositoryProtocol, method_name)
        assert tuple(signature(method).parameters) == parameters

    user_facing = set(expected_parameters) - {"reconcile_interrupted_rounds"}
    for method_name in user_facing:
        assert "owner_id" in signature(
            getattr(RoundRepositoryProtocol, method_name)
        ).parameters
