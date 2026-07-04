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
        writer.writerow(
            [
                "respondentId",
                "name",
                "city",
                "status",
                "completedQuestions",
                "terminationReason",
            ]
        )
        respondents = {item.id: item for item in snapshot.respondents}
        for session in snapshot.sessions:
            respondent = respondents.get(session.respondentId)
            writer.writerow(
                [
                    session.respondentId,
                    respondent.name if respondent else "",
                    respondent.city if respondent else "",
                    session.status,
                    session.completedQuestions,
                    session.terminationReason or "",
                ]
            )
        return ("\ufeff" + output.getvalue()).encode("utf-8")
