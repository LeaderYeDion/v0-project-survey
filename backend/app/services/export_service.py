import csv
import io
import json
from datetime import UTC, datetime

from app.schemas.survey import RunSnapshot, SurveyHistoryRecord


class ExportService:
    def json_bytes(
        self,
        snapshot: RunSnapshot | SurveyHistoryRecord,
    ) -> bytes:
        payload = {
            "exportedAt": datetime.now(UTC).isoformat(),
            "totalRespondents": len(snapshot.respondents),
            "completedInterviews": sum(
                session.status == "completed"
                for session in snapshot.sessions
            ),
            "sessions": [
                {
                    "respondentId": session.respondentId,
                    "status": session.status,
                    "terminationReason": session.terminationReason,
                    "completedQuestions": session.completedQuestions,
                    "dialog": [
                        item.model_dump(mode="json")
                        for item in session.dialog
                    ],
                }
                for session in snapshot.sessions
            ],
            "respondents": [
                item.model_dump(mode="json")
                for item in snapshot.respondents
            ],
            "inferenceResults": [
                item.model_dump(mode="json")
                for item in snapshot.inferenceResults
            ],
            "inferenceSummary": [
                item.model_dump(mode="json")
                for item in snapshot.inferenceSummary
            ],
        }
        return json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")

    def csv_bytes(
        self,
        snapshot: RunSnapshot | SurveyHistoryRecord,
    ) -> bytes:
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        inference_tasks = []
        seen_task_ids: set[str] = set()
        for result in snapshot.inferenceResults:
            if result.taskId in seen_task_ids:
                continue
            seen_task_ids.add(result.taskId)
            inference_tasks.append(result)
        base_headers = [
            "respondentId",
            "name",
            "city",
            "status",
            "completedQuestions",
            "terminationReason",
        ]
        inference_headers: list[str] = []
        for task in inference_tasks:
            prefix = f"inference.{task.kind}.{task.taskName}"
            inference_headers.extend([prefix, f"{prefix}.reason", f"{prefix}.status"])
        writer.writerow(base_headers + inference_headers)
        respondents = {item.id: item for item in snapshot.respondents}
        inference_by_respondent_task = {
            (item.respondentId, item.taskId): item
            for item in snapshot.inferenceResults
        }
        for session in snapshot.sessions:
            respondent = respondents.get(session.respondentId)
            inference_cells: list[str] = []
            for task in inference_tasks:
                result = inference_by_respondent_task.get(
                    (session.respondentId, task.taskId)
                )
                if result is None:
                    inference_cells.extend(["", "", ""])
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
                    ]
                )
            writer.writerow(
                [
                    session.respondentId,
                    respondent.name if respondent else "",
                    respondent.city if respondent else "",
                    session.status,
                    session.completedQuestions,
                    session.terminationReason or "",
                ]
                + inference_cells
            )
        return ("\ufeff" + output.getvalue()).encode("utf-8")
