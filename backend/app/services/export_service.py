from __future__ import annotations

import asyncio
import csv
import io
import json
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from uuid import UUID

from app.api.errors import ApiError
from app.db.errors import STORAGE_ERRORS, storage_unavailable
from app.repositories.protocols import ExportRepositoryProtocol
from app.schemas.analytics import DimensionKey
from app.schemas.exports import (
    ExportDocument, ExportInferenceResult, ExportProjectReference,
    ExportQuestionnaireReference, ExportRecord, ExportRequest,
    ExportRoundMetadata, GeneratedExport,
)
from app.schemas.survey import RespondentProfile, RunSnapshot
from app.services.exception_service import EXCEPTION_STATUSES, ExceptionService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.run_service import RunService


class ExportService:
    def __init__(
        self,
        repository: ExportRepositoryProtocol,
        run_service: RunService,
    ) -> None:
        self.repository = repository
        self.run_service = run_service
        self.processing_timeout = timedelta(minutes=5)

    async def generate(
        self,
        owner_id: UUID,
        round_id: UUID,
        request: ExportRequest,
    ) -> GeneratedExport:
        filename = self._safe_filename(
            request.filename,
            round_id,
            request.format,
        )
        record = await self.repository.create_export(
            owner_id,
            round_id,
            {
                "format": request.format,
                "scope": request.scope,
                "filters_json": request.filters,
                "filename": filename,
            },
        )
        if record is None:
            raise _not_found()

        try:
            snapshot = await self.run_service.get(owner_id, round_id)
            selected = self._select(snapshot, request)
            if not selected.respondents:
                raise _EmptyExportScopeError
            config_version = await self.run_service.research.get_config_version(
                owner_id, UUID(snapshot.configVersionId)
            )
            document = ExportDocument(
                scope=request.scope,
                filters=request.filters,
                appliedFilters={key: value for key, value in request.filters.items()
                    if request.scope == "filtered" and value},
                populationCount=len(snapshot.respondents),
                round=ExportRoundMetadata(
                    id=snapshot.id, name=snapshot.name, mode=snapshot.mode,
                    locale=snapshot.locale, status=snapshot.status, rowVersion=snapshot.rowVersion,
                    projectId=snapshot.projectId, questionnaireId=snapshot.questionnaireId,
                    questionnaireVersionId=snapshot.questionnaireVersionId,
                    configVersionId=snapshot.configVersionId, parentRoundId=snapshot.parentRoundId,
                    retryOfRoundId=snapshot.retryOfRoundId, retryKind=snapshot.retryKind,
                    createdAt=snapshot.createdAt, updatedAt=snapshot.updatedAt,
                    startedAt=snapshot.startedAt, finishedAt=snapshot.finishedAt,
                    errorCode=snapshot.errorCode, errorMessage=snapshot.error, progress=snapshot.progress,
                ),
                project=ExportProjectReference(id=snapshot.projectId),
                questionnaire=ExportQuestionnaireReference(
                    id=snapshot.questionnaireId, versionId=snapshot.questionnaireVersionId,
                ),
                configVersion=config_version, config=snapshot.config, exportedAt=datetime.now(UTC),
                totalRespondents=len(selected.respondents),
                completedInterviews=sum(session.status == "completed" for session in selected.sessions),
                sessions=selected.sessions, respondents=selected.respondents, responses=selected.responses,
                exceptions=ExceptionService().report(selected),
                inferenceResults=[ExportInferenceResult(
                    id=item.id, runId=item.runId, respondentId=item.respondentId,
                    taskId=item.taskId, taskName=item.taskName, kind=item.kind,
                    value=item.value, reason=item.reason, evidence=item.evidence, status=item.status,
                    errorCode=item.errorCode or ("INFERENCE_FAILED" if item.status == "failed" else None),
                    errorMessage=item.errorMessage or item.error,
                ) for item in selected.inferenceResults],
                inferenceSummary=selected.inferenceSummary,
            )
            content, media_type = self._render(document, request.format)
            content_disposition = self._content_disposition(
                filename,
                round_id,
                request.format,
            )
            content_disposition.encode("latin-1")
            succeeded = await self.repository.mark_succeeded(
                owner_id, record.id, filename, datetime.now(UTC)
            )
            if succeeded is None:
                raise RuntimeError("Export finalization conflict")
        except (Exception, asyncio.CancelledError) as error:
            if isinstance(error, _EmptyExportScopeError):
                failure = ApiError(422, "EXPORT_SCOPE_EMPTY", "The selected export scope has no respondents")
            elif isinstance(error, STORAGE_ERRORS) or (
                isinstance(error, ApiError) and error.code == "STORAGE_UNAVAILABLE"
            ):
                failure = storage_unavailable()
            else:
                failure = ApiError(500, "EXPORT_GENERATION_FAILED", "Export generation failed")
            try:
                # Separate transaction; an outage here is later repaired by the stale sweep.
                await self.repository.mark_failed(
                    owner_id, record.id, failure.code, failure.message, datetime.now(UTC)
                )
            except STORAGE_ERRORS:
                failure = storage_unavailable()
            except ApiError as persistence_error:
                if persistence_error.code != "STORAGE_UNAVAILABLE":
                    raise
                failure = storage_unavailable()
            if isinstance(error, asyncio.CancelledError):
                raise
            raise failure from None
        return GeneratedExport(
            content=content,
            media_type=media_type,
            filename=filename,
            content_disposition=content_disposition,
            record_id=str(record.id),
        )

    async def recover_stale_exports(self, now: datetime | None = None):
        now = now or datetime.now(UTC)
        return await self.repository.fail_stale_processing(now - self.processing_timeout, now)

    async def list(self, owner_id: UUID, round_id: UUID) -> list[ExportRecord]:
        owned = await self.run_service.repository.get_for_owner(
            owner_id,
            round_id,
        )
        if owned is None:
            raise _not_found()
        rows = await self.repository.list_exports_for_owner(owner_id, round_id)
        return [
            ExportRecord(
                id=str(row.id),
                roundId=str(row.round_id),
                requestedByUserId=str(row.requested_by_user_id),
                format=row.format,
                scope=row.scope,
                filters=row.filters_json,
                filename=row.filename,
                status=row.status,
                createdAt=row.created_at,
                finishedAt=row.finished_at,
                errorCode=row.error_code,
                errorMessage=row.error_message,
            )
            for row in rows
        ]

    @staticmethod
    def _safe_filename(
        requested: str,
        round_id: UUID,
        format: str,
    ) -> str:
        stem = re.sub(r"[\x00-\x1f\x7f/\\\";]", "", requested)
        stem = re.sub(r"\s+", " ", stem).strip().lstrip(".")
        stem = re.sub(r"\.[^.\s]+$", "", stem).strip().rstrip(".")
        if not stem:
            stem = f"research-round-{str(round_id)[:8]}"
        max_stem_length = 255 - len(format) - 1
        stem = stem[:max_stem_length].rstrip()
        return f"{stem}.{format}"

    @staticmethod
    def _content_disposition(
        filename: str,
        round_id: UUID,
        format: str,
    ) -> str:
        try:
            filename.encode("ascii")
        except UnicodeEncodeError:
            fallback = f"research-round-{str(round_id)[:8]}.{format}"
            return (
                f'attachment; filename="{fallback}"; '
                f"filename*=UTF-8''{quote(filename, safe='')}"
            )
        return f'attachment; filename="{filename}"'

    def _select(
        self,
        snapshot: RunSnapshot,
        request: ExportRequest,
    ) -> RunSnapshot:
        if request.scope == "full":
            selected_ids = {item.id for item in snapshot.respondents}
        elif request.scope == "exceptions":
            selected_ids = {
                session.respondentId
                for session in snapshot.sessions
                if session.status in EXCEPTION_STATUSES
            }
        else:
            selected_ids = {
                respondent.id
                for respondent in snapshot.respondents
                if self._matches_filters(snapshot, respondent, request.filters)
            }
        selected = snapshot.model_copy(
            deep=True,
            update={
                "respondents": [
                    item for item in snapshot.respondents if item.id in selected_ids
                ],
                "sessions": [
                    item
                    for item in snapshot.sessions
                    if item.respondentId in selected_ids
                ],
                "responses": [
                    item
                    for item in snapshot.responses
                    if item.respondentId in selected_ids
                ],
                "inferenceResults": [
                    item
                    for item in snapshot.inferenceResults
                    if item.respondentId in selected_ids
                ],
            },
        )
        selected.inferenceSummary = InferenceAnalysisService().summarize(selected.inferenceResults)
        return selected

    @staticmethod
    def _matches_filters(
        snapshot: RunSnapshot,
        respondent: RespondentProfile,
        filters: dict[DimensionKey, str],
    ) -> bool:
        configs = {item.id: item for item in snapshot.config.respondentConfigs}
        config = configs.get(respondent.configId)
        for key, expected in filters.items():
            if not expected:
                continue
            if key == "ageRange":
                actual = config.ageRange if config is not None else "Unknown"
            else:
                actual = getattr(respondent, key, None) or getattr(
                    config,
                    key,
                    "Unknown",
                )
            if str(actual or "Unknown") != expected:
                return False
        return True

    def _render(self, document: ExportDocument, format: str) -> tuple[bytes, str]:
        if format == "json":
            return self.json_bytes(document), "application/json"
        return self.csv_bytes(document), "text/csv; charset=utf-8"

    def json_bytes(self, document: ExportDocument) -> bytes:
        return document.model_dump_json(by_alias=True, indent=2).encode("utf-8")

    def csv_bytes(self, snapshot: ExportDocument) -> bytes:
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        inference_tasks = []
        config = snapshot.config.inferenceConfig
        if config is not None:
            inference_tasks = [
                (kind, task.id)
                for kind, tasks in (("profile", config.profileTasks), ("attitude", config.attitudeTasks))
                for task in tasks
            ]
        base_headers = [
            "respondentId",
            "name",
            "city",
            "status",
            "completedQuestions",
            "terminationCode",
            "terminationReason",
            "errorCode",
            "errorMessage",
        ]
        answer_headers = [f"answer.{question.id}" for question in snapshot.config.questions]
        inference_headers: list[str] = []
        for kind, task_id in inference_tasks:
            # Escape dots too: an ID ending in '.reason' cannot shadow a field.
            encoded_id = quote(task_id, safe="").replace(".", "%2E")
            prefix = f"inference.{kind}.{encoded_id}"
            inference_headers.extend(
                [prefix, f"{prefix}.reason", f"{prefix}.status", f"{prefix}.errorCode", f"{prefix}.errorMessage"]
            )
        writer.writerow(base_headers + answer_headers + inference_headers)
        respondents = {item.id: item for item in snapshot.respondents}
        answers_by_respondent = {item.respondentId: item.answers for item in snapshot.responses}
        inference_by_respondent_task = {
            (item.respondentId, item.kind, item.taskId): item
            for item in snapshot.inferenceResults
        }
        for session in snapshot.sessions:
            respondent = respondents.get(session.respondentId)
            inference_cells: list[str] = []
            for kind, task_id in inference_tasks:
                result = inference_by_respondent_task.get(
                    (session.respondentId, kind, task_id)
                )
                if result is None:
                    inference_cells.extend(["", "", "", "", ""])
                    continue
                value = result.value
                rendered_value = (
                    "、".join(value)
                    if isinstance(value, list)
                    else value or ""
                )
                inference_cells.extend(
                    [
                        rendered_value if result.status == "completed" else "",
                        result.reason or "" if result.status == "completed" else "",
                        result.status,
                        result.errorCode or "",
                        result.errorMessage or "",
                    ]
                )
            writer.writerow(
                [
                    session.respondentId,
                    respondent.name if respondent else "",
                    respondent.city if respondent else "",
                    session.status,
                    session.completedQuestions,
                    session.terminationCode or "",
                    session.terminationReason or "",
                    session.errorCode or "",
                    session.errorMessage or "",
                ]
                + [
                    _answer_cell(answers_by_respondent.get(session.respondentId, {}).get(question.id))
                    for question in snapshot.config.questions
                ]
                + inference_cells
            )
        return ("\ufeff" + output.getvalue()).encode("utf-8")


def _not_found() -> ApiError:
    return ApiError(
        404,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
    )


class _EmptyExportScopeError(Exception):
    pass


def _answer_cell(answer) -> str:
    if answer is None:
        return ""
    value = answer.value
    return json.dumps(value, ensure_ascii=False) if isinstance(value, list) else str(value)
