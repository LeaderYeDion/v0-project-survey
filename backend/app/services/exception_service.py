from __future__ import annotations

from collections import defaultdict

from app.schemas.analytics import (
    ExceptionGroup,
    ExceptionReport,
    ExceptionRespondent,
)
from app.schemas.survey import InterviewSession, RunSnapshot


EXCEPTION_STATUSES = frozenset(
    {
        "terminated_by_respondent",
        "terminated_by_interviewer",
        "failed",
    }
)


class ExceptionService:
    def report(self, snapshot: RunSnapshot) -> ExceptionReport:
        sessions = {session.respondentId: session for session in snapshot.sessions}
        grouped: dict[tuple[str, str], list[ExceptionRespondent]] = defaultdict(list)
        group_reasons: dict[tuple[str, str], str] = {}

        for profile in snapshot.respondents:
            session = sessions.get(profile.id)
            if session is None or session.status not in EXCEPTION_STATUSES:
                continue
            code = self._code(session)
            reason = self._reason(session, snapshot.locale)
            key = (session.status, code)
            group_reasons.setdefault(key, reason)
            last_answer = next(
                (
                    message
                    for message in reversed(session.dialog)
                    if message.role == "respondent"
                    and message.answerValue is not None
                ),
                None,
            )
            grouped[key].append(
                ExceptionRespondent(
                    respondentId=profile.id,
                    profile=profile,
                    completedQuestions=session.completedQuestions,
                    totalQuestions=session.totalQuestions,
                    lastValidAnswer=(last_answer.content if last_answer else None),
                    lastValidAnswerAt=(last_answer.timestamp if last_answer else None),
                    status=session.status,
                    reason=reason,
                    startedAt=session.startTime,
                    finishedAt=session.endTime,
                )
            )

        groups = [
            ExceptionGroup(
                status=status,
                code=code,
                reason=group_reasons[(status, code)],
                count=len(respondents),
                respondents=respondents,
            )
            for (status, code), respondents in grouped.items()
        ]
        groups.sort(key=lambda group: (-group.count, group.code, group.status))
        return ExceptionReport(
            roundId=snapshot.id,
            totalCount=sum(group.count for group in groups),
            groups=groups,
        )

    @staticmethod
    def _code(session: InterviewSession) -> str:
        if session.status == "failed":
            return session.errorCode or "UNKNOWN_ERROR"
        return session.terminationCode or "UNKNOWN_TERMINATION"

    @staticmethod
    def _reason(session: InterviewSession, locale: str) -> str:
        if (
            session.status == "failed"
            and session.errorCode == "RESPONDENT_EXECUTION_FAILED"
        ):
            return (
                "受访者执行失败"
                if locale == "zh-CN"
                else "Respondent execution failed"
            )
        reason = (
            session.errorMessage
            if session.status == "failed"
            else session.terminationReason
        )
        if reason:
            return reason
        if session.status == "failed":
            return "执行失败" if locale == "zh-CN" else "Execution failed"
        return "提前终止" if locale == "zh-CN" else "Terminated early"
