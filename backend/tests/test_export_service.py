from __future__ import annotations

import json
import csv
import io
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.api.errors import ApiError
from app.repositories.exports import ExportRepository
from app.schemas.exports import ExportRequest
from app.schemas.rounds import RoundSnapshot
from app.schemas.research import ConfigVersionView
from app.schemas.survey import (
    InterviewSession,
    RespondentConfig,
    RespondentProfile,
    RunSnapshot,
    SurveyConfig,
    SurveyQuestion,
    SurveyResponse,
    InferenceResult,
    InferenceConfig,
)
from app.services.export_service import ExportService


def _snapshot(round_id: UUID) -> RunSnapshot:
    config = SurveyConfig(
        title="Export scope",
        description="",
        questions=[
            SurveyQuestion(id="q2", type="text", question="Explain"),
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
    base = RunSnapshot.empty(
        run_id=str(round_id),
        mode="survey",
        locale="en-US",
        config=config,
        created_at=datetime.now(UTC),
    ).model_copy(update={"respondents": profiles, "sessions": sessions, "responses": [
        SurveyResponse(id="answer-1", surveyId=str(round_id), respondentId="r1", answers={"q1": {"type": "choice", "value": "A"}}, status="completed"),
    ]})
    return RoundSnapshot(**base.model_dump(), name="Export scope", projectId=str(uuid4()),
        questionnaireId=str(uuid4()), questionnaireVersionId=str(uuid4()), configVersionId=str(uuid4()), rowVersion=7,
        updatedAt=base.createdAt)


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
        self.research = self

    async def get_config_version(self, owner_id, config_id):
        assert owner_id == self.owner_id
        assert str(config_id) == self.snapshot.configVersionId
        return ConfigVersionView(id=config_id, project_id=self.snapshot.projectId,
            questionnaire_version_id=self.snapshot.questionnaireVersionId, version_number=2,
            schema_version=1, full_snapshot=self.snapshot.config, content_hash="frozen-config-hash",
            created_at=self.snapshot.createdAt)

    async def get(self, owner_id: UUID, round_id: UUID) -> RunSnapshot:
        if owner_id != self.owner_id or str(round_id) != self.snapshot.id:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "Not found")
        return self.snapshot


class UpstreamErrorRunService:
    def __init__(
        self,
        export_repository: ExportRepository,
        owner_id: UUID,
        round_id: UUID,
    ) -> None:
        self.export_repository = export_repository
        self.owner_id = owner_id
        self.round_id = round_id
        self.observed_statuses: list[str] = []

    async def get(self, owner_id: UUID, round_id: UUID) -> RunSnapshot:
        rows = await self.export_repository.list_exports_for_owner(
            owner_id,
            round_id,
        )
        self.observed_statuses = [row.status for row in rows]
        raise ApiError(409, "UPSTREAM_CONFLICT", "Snapshot changed")


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


@pytest.mark.asyncio
async def test_upstream_api_error_transitions_processing_record_to_failed() -> None:
    owner_id = uuid4()
    round_id = uuid4()
    repository = ExportRepository(
        round_repository=OwnedRoundRepository(owner_id, round_id)
    )
    run_service = UpstreamErrorRunService(
        repository,
        owner_id,
        round_id,
    )
    service = ExportService(repository=repository, run_service=run_service)

    with pytest.raises(ApiError) as captured:
        await service.generate(
            owner_id,
            round_id,
            ExportRequest(format="json", scope="full"),
        )

    assert run_service.observed_statuses == ["processing"]
    assert (captured.value.status_code, captured.value.code) == (
        500,
        "EXPORT_GENERATION_FAILED",
    )
    records = await repository.list_exports_for_owner(owner_id, round_id)
    assert [(row.status, row.error_code) for row in records] == [
        ("failed", "EXPORT_GENERATION_FAILED")
    ]


@pytest.mark.asyncio
async def test_json_export_preserves_metadata_answers_and_exact_scope(export_harness):
    owner, round_id, _, service = export_harness
    result = await service.generate(owner, round_id, ExportRequest(format="json", scope="filtered", filters={"city": "Hangzhou"}))
    payload = json.loads(result.content)
    source = service.run_service.snapshot
    assert payload["round"]["id"] == str(round_id)
    assert payload["round"]["rowVersion"] == 7
    assert payload["project"] == {"id": source.projectId}
    assert payload["questionnaire"] == {"id": source.questionnaireId, "versionId": source.questionnaireVersionId}
    assert payload["configVersion"]["id"] == source.configVersionId
    assert payload["configVersion"]["versionNumber"] == 2
    assert payload["configVersion"]["contentHash"] == "frozen-config-hash"
    assert [q["id"] for q in payload["config"]["questions"]] == ["q2", "q1"]
    assert payload["configVersion"]["fullSnapshot"] == payload["config"]
    assert (payload["scope"], payload["filters"], payload["appliedFilters"]) == ("filtered", {"city": "Hangzhou"}, {"city": "Hangzhou"})
    assert (payload["populationCount"], payload["totalRespondents"]) == (3, 2)
    assert [r["respondentId"] for r in payload["responses"]] == ["r1"]
    assert payload["responses"][0]["answers"]["q1"] == {"type": "choice", "value": "A"}
    assert payload["exceptions"]["totalCount"] == 1
    assert payload["exceptions"]["groups"][0]["code"] == "STOPPED"
    assert payload["sessions"][1]["terminationCode"] == "STOPPED"


@pytest.mark.asyncio
async def test_csv_has_questionnaire_order_answers_and_failure_fields(export_harness):
    owner, round_id, _, service = export_harness
    result = await service.generate(owner, round_id, ExportRequest(format="csv", scope="full"))
    reader = csv.DictReader(io.StringIO(result.content.decode("utf-8-sig")))
    rows = list(reader)
    assert [name for name in reader.fieldnames if name.startswith("answer.")] == ["answer.q2", "answer.q1"]
    assert rows[0]["answer.q1"] == "A"
    assert rows[0]["answer.q2"] == ""
    assert rows[1]["terminationCode"] == "STOPPED"
    assert rows[1]["terminationReason"] == "Stopped"
    assert rows[2]["errorCode"] == "FAILED"
    assert rows[2]["errorMessage"] == "Failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["cas", "storage"])
async def test_success_finalization_failure_leaves_failed_record(export_harness, monkeypatch, failure):
    owner, round_id, repository, service = export_harness
    async def fail_finish(*_args):
        if failure == "storage":
            raise ApiError(503, "STORAGE_UNAVAILABLE", "Storage unavailable")
        return None
    monkeypatch.setattr(repository, "mark_succeeded", fail_finish)
    with pytest.raises(ApiError) as captured:
        await service.generate(owner, round_id, ExportRequest(format="json", scope="full"))
    assert captured.value.code == ("STORAGE_UNAVAILABLE" if failure == "storage" else "EXPORT_GENERATION_FAILED")
    rows = await repository.list_exports_for_owner(owner, round_id)
    assert rows[0].status == "failed"
    assert rows[0].error_code == captured.value.code


@pytest.mark.asyncio
async def test_failed_failure_write_is_recovered_after_storage_returns(export_harness, monkeypatch):
    owner, round_id, repository, service = export_harness
    async def unavailable(*_args):
        raise ApiError(503, "STORAGE_UNAVAILABLE", "Storage unavailable")
    with monkeypatch.context() as patch:
        patch.setattr(repository, "mark_succeeded", unavailable)
        patch.setattr(repository, "mark_failed", unavailable)
        with pytest.raises(ApiError):
            await service.generate(owner, round_id, ExportRequest(format="json", scope="full"))
    await service.recover_stale_exports(datetime.now(UTC) + timedelta(minutes=10))
    rows = await repository.list_exports_for_owner(owner, round_id)
    assert rows[0].status == "failed"
    assert rows[0].error_code == "EXPORT_GENERATION_INTERRUPTED"
    assert rows[0].finished_at is not None


@pytest.mark.asyncio
async def test_filtered_inference_summary_contains_only_selected_respondents(export_harness):
    from app.services.inference_analysis_service import InferenceAnalysisService
    owner, round_id, _, service = export_harness
    snapshot = service.run_service.snapshot
    snapshot.inferenceResults = [InferenceResult(
        id=str(uuid4()), runId=str(round_id), respondentId=respondent,
        taskId="t1", taskName="Opinion", kind="attitude", status="completed", value=value,
    ) for respondent, value in [("r1", "positive"), ("r3", "negative")]]
    snapshot.inferenceSummary = InferenceAnalysisService().summarize(snapshot.inferenceResults)
    result = await service.generate(owner, round_id, ExportRequest(format="json", scope="filtered", filters={"city": "Hangzhou"}))
    payload = json.loads(result.content)
    assert [r["respondentId"] for r in payload["inferenceResults"]] == ["r1"]
    assert payload["inferenceSummary"][0]["total"] == 1
    assert payload["inferenceSummary"][0]["distribution"] == {"positive": 1}


@pytest.mark.asyncio
async def test_stale_recovery_preserves_recent_processing_and_terminal_records(export_harness):
    owner, round_id, repository, service = export_harness
    payload = {"format": "json", "scope": "full", "filters_json": {}, "filename": "out.json"}
    succeeded = await repository.create_export(owner, round_id, payload)
    failed = await repository.create_export(owner, round_id, payload)
    recent = await repository.create_export(owner, round_id, payload)
    await repository.mark_succeeded(owner, succeeded.id, "out.json", datetime.now(UTC))
    await repository.mark_failed(owner, failed.id, "EXPORT_GENERATION_FAILED", "Failed", datetime.now(UTC))
    assert await service.recover_stale_exports() == ()
    records = {r.id: r for r in await repository.list_exports_for_owner(owner, round_id)}
    assert [records[r.id].status for r in (succeeded, failed, recent)] == ["succeeded", "failed", "processing"]
    await service.recover_stale_exports(datetime.now(UTC) + timedelta(minutes=10))
    records = {r.id: r for r in await repository.list_exports_for_owner(owner, round_id)}
    assert [records[r.id].status for r in (succeeded, failed, recent)] == ["succeeded", "failed", "failed"]
    assert records[failed.id].error_code == "EXPORT_GENERATION_FAILED"


@pytest.mark.asyncio
async def test_json_export_has_explicit_schema_and_stable_key_order(export_harness):
    import app.schemas.exports as export_schema
    owner, round_id, _, service = export_harness
    result = await service.generate(owner, round_id, ExportRequest(format="json", scope="full"))
    payload = json.loads(result.content)
    assert hasattr(export_schema, "ExportDocument"), "Exports need a declared DTO"
    document = export_schema.ExportDocument.model_validate(payload)
    assert list(document.model_dump(mode="json", by_alias=True)) == list(payload) == [
        "schemaVersion", "scope", "filters", "appliedFilters", "populationCount",
        "round", "project", "questionnaire", "configVersion", "config", "exportedAt",
        "totalRespondents", "completedInterviews", "sessions", "respondents", "responses",
        "exceptions", "inferenceResults", "inferenceSummary",
    ]
    assert list(payload["round"]) == [
        "id", "name", "mode", "locale", "status", "rowVersion", "projectId",
        "questionnaireId", "questionnaireVersionId", "configVersionId", "parentRoundId",
        "retryOfRoundId", "retryKind", "createdAt", "updatedAt", "startedAt", "finishedAt",
        "errorCode", "errorMessage", "progress",
    ]


@pytest.mark.asyncio
async def test_applied_filters_exclude_empty_values_but_retain_requested_filters(export_harness):
    owner, round_id, _, service = export_harness
    result = await service.generate(owner, round_id, ExportRequest(
        format="json", scope="filtered", filters={"city": "Hangzhou", "gender": ""},
    ))
    payload = json.loads(result.content)
    assert payload["filters"] == {"city": "Hangzhou", "gender": ""}
    assert payload["appliedFilters"] == {"city": "Hangzhou"}
    assert [r["id"] for r in payload["respondents"]] == ["r1", "r2"]


def _configured_inference(snapshot):
    snapshot.config.inferenceConfig = InferenceConfig(
        enabled=True, profileEnabled=True, attitudeEnabled=True,
        profileTasks=[
            {"id": "p2", "name": "Same name", "options": ["A", "B"]},
            {"id": "p1", "name": "Same name", "options": ["A", "B"]},
        ],
        attitudeTasks=[{"id": "a1", "name": "Opinion", "options": ["positive", "negative"]}],
    )


@pytest.mark.asyncio
async def test_csv_inference_headers_follow_config_order_even_without_results(export_harness):
    owner, round_id, _, service = export_harness
    _configured_inference(service.run_service.snapshot)
    result = await service.generate(owner, round_id, ExportRequest(format="csv", scope="full"))
    reader = csv.DictReader(io.StringIO(result.content.decode("utf-8-sig")))
    rows = list(reader)
    assert reader.fieldnames == [
        "respondentId", "name", "city", "status", "completedQuestions", "terminationCode",
        "terminationReason", "errorCode", "errorMessage", "answer.q2", "answer.q1",
        "inference.profile.p2", "inference.profile.p2.reason", "inference.profile.p2.status",
        "inference.profile.p2.errorCode", "inference.profile.p2.errorMessage",
        "inference.profile.p1", "inference.profile.p1.reason", "inference.profile.p1.status",
        "inference.profile.p1.errorCode", "inference.profile.p1.errorMessage",
        "inference.attitude.a1", "inference.attitude.a1.reason", "inference.attitude.a1.status",
        "inference.attitude.a1.errorCode", "inference.attitude.a1.errorMessage",
    ]
    assert all(row[column] == "" for row in rows for column in reader.fieldnames if column.startswith("inference."))


@pytest.mark.asyncio
async def test_same_name_inference_tasks_keep_distinct_values_and_failure_fields(export_harness):
    owner, round_id, _, service = export_harness
    snapshot = service.run_service.snapshot
    _configured_inference(snapshot)
    # Deliberately reverse result order and supply a failed result with no value.
    snapshot.inferenceResults = [
        InferenceResult(id="result-p1", runId=str(round_id), respondentId="r1", taskId="p1",
            taskName="Same name", kind="profile", status="failed", error="Provider unavailable"),
        InferenceResult(id="result-p2", runId=str(round_id), respondentId="r1", taskId="p2",
            taskName="Same name", kind="profile", status="completed", value="B", reason="Evidence"),
    ]
    result = await service.generate(owner, round_id, ExportRequest(format="csv", scope="full"))
    reader = csv.DictReader(io.StringIO(result.content.decode("utf-8-sig")))
    rows = list(reader)
    assert len(reader.fieldnames) == len(set(reader.fieldnames))
    assert rows[0]["inference.profile.p2"] == "B"
    assert rows[0]["inference.profile.p2.reason"] == "Evidence"
    assert rows[0]["inference.profile.p1"] == ""
    assert rows[0]["inference.profile.p1.status"] == "failed"
    assert rows[0]["inference.profile.p1.errorCode"] == "INFERENCE_FAILED"
    assert rows[0]["inference.profile.p1.errorMessage"] == "Provider unavailable"


@pytest.mark.asyncio
async def test_task_ids_cannot_collide_with_inference_field_suffixes(export_harness):
    owner, round_id, _, service = export_harness
    snapshot = service.run_service.snapshot
    snapshot.config.inferenceConfig = InferenceConfig(profileTasks=[
        {"id": "p1", "name": "One", "options": ["A"]},
        {"id": "p1.reason", "name": "Two", "options": ["A"]},
    ])
    result = await service.generate(owner, round_id, ExportRequest(format="csv", scope="full"))
    headers = next(csv.reader(io.StringIO(result.content.decode("utf-8-sig"))))
    assert len(headers) == len(set(headers))
    assert "inference.profile.p1%2Ereason" in headers
