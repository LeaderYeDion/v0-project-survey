from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.api.errors import ApiError
from app.repositories.exports import ExportRepository
from app.schemas.exports import ExportRequest
from app.schemas.survey import (
    InterviewSession,
    RespondentConfig,
    RespondentProfile,
    RunSnapshot,
    SurveyConfig,
    SurveyQuestion,
)
from app.services.export_service import ExportService


def _snapshot(round_id: UUID) -> RunSnapshot:
    config = SurveyConfig(
        title="Export scope",
        description="",
        questions=[
            SurveyQuestion(
                id="q1",
                type="choice",
                question="Choose",
                options=["A", "B"],
            )
        ],
        maxResponseTime=30,
        respondentConfigs=[
            RespondentConfig(
                id="hz",
                gender="all",
                ageRange="18-35",
                occupation="all",
                city="Hangzhou",
                income="all",
                count=2,
            ),
            RespondentConfig(
                id="sh",
                gender="all",
                ageRange="36-65",
                occupation="all",
                city="Shanghai",
                income="all",
                count=1,
            ),
        ],
    )
    profiles = [
        RespondentProfile(
            id=respondent_id,
            name=name,
            nickname=name,
            avatar="avatar",
            age=age,
            gender=gender,
            occupation="researcher",
            city=city,
            income="middle",
            education="college",
            maritalStatus="single",
            tags=[],
            configId=config_id,
        )
        for respondent_id, name, age, gender, city, config_id in (
            ("r1", "One", 25, "woman", "Hangzhou", "hz"),
            ("r2", "Two", 29, "man", "Hangzhou", "hz"),
            ("r3", "Three", 45, "woman", "Shanghai", "sh"),
        )
    ]
    sessions = [
        InterviewSession(
            respondentId="r1",
            status="completed",
            completedQuestions=1,
            totalQuestions=1,
        ),
        InterviewSession(
            respondentId="r2",
            status="terminated_by_respondent",
            terminationCode="STOPPED",
            terminationReason="Stopped",
            completedQuestions=0,
            totalQuestions=1,
        ),
        InterviewSession(
            respondentId="r3",
            status="failed",
            errorCode="FAILED",
            errorMessage="Failed",
            completedQuestions=0,
            totalQuestions=1,
        ),
    ]
    return RunSnapshot.empty(
        run_id=str(round_id),
        mode="survey",
        locale="en-US",
        config=config,
        created_at=datetime.now(UTC),
    ).model_copy(update={"respondents": profiles, "sessions": sessions})


class OwnedRoundRepository:
    def __init__(self, owner_id: UUID, round_id: UUID) -> None:
        self.owner_id = owner_id
        self.round_id = round_id

    async def get_for_owner(self, owner_id: UUID, round_id: UUID):
        if (owner_id, round_id) == (self.owner_id, self.round_id):
            return SimpleNamespace(id=round_id)
        return None


class SnapshotRunService:
    def __init__(self, owner_id: UUID, snapshot: RunSnapshot) -> None:
        self.owner_id = owner_id
        self.snapshot = snapshot

    async def get(self, owner_id: UUID, round_id: UUID) -> RunSnapshot:
        if owner_id != self.owner_id or str(round_id) != self.snapshot.id:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "Not found")
        return self.snapshot


@pytest.fixture
def export_harness():
    owner_id = uuid4()
    round_id = uuid4()
    snapshot = _snapshot(round_id)
    repository = ExportRepository(
        round_repository=OwnedRoundRepository(owner_id, round_id)
    )
    service = ExportService(
        repository=repository,
        run_service=SnapshotRunService(owner_id, snapshot),
    )
    return owner_id, round_id, repository, service


@pytest.mark.asyncio
async def test_full_json_export_contains_every_respondent(export_harness) -> None:
    owner_id, round_id, _repository, service = export_harness

    generated = await service.generate(
        owner_id,
        round_id,
        ExportRequest(format="json", scope="full"),
    )

    payload = json.loads(generated.content)
    assert [item["id"] for item in payload["respondents"]] == ["r1", "r2", "r3"]
    assert generated.media_type == "application/json"
    assert generated.filename == f"research-round-{str(round_id)[:8]}.json"


@pytest.mark.asyncio
async def test_filtered_csv_export_reapplies_validated_demographics_and_safe_name(
    export_harness,
) -> None:
    owner_id, round_id, repository, service = export_harness

    generated = await service.generate(
        owner_id,
        round_id,
        ExportRequest(
            format="csv",
            scope="filtered",
            filename="../city\x00   report.csv",
            filters={"city": "Hangzhou", "ageRange": "18-35"},
        ),
    )

    rendered = generated.content.decode("utf-8-sig")
    assert "r1,One,Hangzhou" in rendered
    assert "r2,Two,Hangzhou" in rendered
    assert "r3,Three,Shanghai" not in rendered
    assert generated.filename == "city report.csv"
    records = await repository.list_exports_for_owner(owner_id, round_id)
    assert [(row.filename, row.status) for row in records] == [
        ("city report.csv", "succeeded")
    ]


@pytest.mark.asyncio
async def test_exception_export_contains_only_terminated_and_failed_respondents(
    export_harness,
) -> None:
    owner_id, round_id, _repository, service = export_harness

    generated = await service.generate(
        owner_id,
        round_id,
        ExportRequest(format="json", scope="exceptions", filename="exceptions"),
    )

    payload = json.loads(generated.content)
    assert [item["id"] for item in payload["respondents"]] == ["r2", "r3"]
    assert [item["status"] for item in payload["sessions"]] == [
        "terminated_by_respondent",
        "failed",
    ]


@pytest.mark.asyncio
async def test_empty_scope_returns_422_and_does_not_record_false_success(
    export_harness,
) -> None:
    owner_id, round_id, repository, service = export_harness

    with pytest.raises(ApiError) as captured:
        await service.generate(
            owner_id,
            round_id,
            ExportRequest(
                format="json",
                scope="filtered",
                filters={"city": "Ningbo"},
            ),
        )

    assert (captured.value.status_code, captured.value.code) == (
        422,
        "EXPORT_SCOPE_EMPTY",
    )
    records = await repository.list_exports_for_owner(owner_id, round_id)
    assert [(row.status, row.error_code) for row in records] == [
        ("failed", "EXPORT_SCOPE_EMPTY")
    ]


@pytest.mark.asyncio
async def test_generation_exception_is_persisted_as_failed(export_harness) -> None:
    owner_id, round_id, repository, service = export_harness

    def fail_render(*_args, **_kwargs):
        raise RuntimeError("renderer exploded")

    service._render = fail_render
    with pytest.raises(ApiError) as captured:
        await service.generate(
            owner_id,
            round_id,
            ExportRequest(format="json", scope="full"),
        )

    assert (captured.value.status_code, captured.value.code) == (
        500,
        "EXPORT_GENERATION_FAILED",
    )
    records = await repository.list_exports_for_owner(owner_id, round_id)
    assert [(row.status, row.error_code) for row in records] == [
        ("failed", "EXPORT_GENERATION_FAILED")
    ]
