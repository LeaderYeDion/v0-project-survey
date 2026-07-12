from __future__ import annotations

import random
from hashlib import sha256
from uuid import uuid4

from app.locales import Locale
from app.schemas.survey import (
    InferenceConfig,
    InferenceEvidence,
    InferenceKind,
    InferenceResult,
    InterviewSession,
    RespondentProfile,
)


class InferenceService:
    def __init__(self, rng: random.Random | None = None) -> None:
        self._rng = rng or random.Random()

    async def infer_for_session(
        self,
        *,
        run_id: str,
        respondent: RespondentProfile,
        session: InterviewSession,
        config: InferenceConfig,
        locale: Locale,
    ) -> list[InferenceResult]:
        if not config.enabled:
            return []
        results: list[InferenceResult] = []
        transcript = "\n".join(message.content for message in session.dialog)
        evidence = self._evidence(session)
        if config.profileEnabled:
            for task in config.profileTasks:
                if not task.enabled:
                    continue
                try:
                    values = self._profile_values(
                        task.options,
                        task.multiple,
                        respondent,
                        transcript,
                    )
                    results.append(
                        InferenceResult(
                            id=f"inference-{uuid4()}",
                            runId=run_id,
                            respondentId=respondent.id,
                            taskId=task.id,
                            taskName=task.name,
                            kind="profile",
                            value=values,
                            reason=self._profile_reason(
                                task.name,
                                respondent,
                                transcript,
                            ),
                            evidence=evidence,
                            status="completed",
                        )
                    )
                except Exception as error:
                    results.append(
                        self._failed_result(
                            run_id=run_id,
                            respondent_id=respondent.id,
                            task_id=task.id,
                            task_name=task.name,
                            kind="profile",
                            error=error,
                        )
                    )
        if config.attitudeEnabled:
            for task in config.attitudeTasks:
                if not task.enabled:
                    continue
                try:
                    value = self._attitude_value(task.options, transcript)
                    results.append(
                        InferenceResult(
                            id=f"inference-{uuid4()}",
                            runId=run_id,
                            respondentId=respondent.id,
                            taskId=task.id,
                            taskName=task.name,
                            kind="attitude",
                            value=value,
                            reason=self._attitude_reason(
                                task.name,
                                value,
                                transcript,
                            ),
                            evidence=evidence,
                            status="completed",
                        )
                    )
                except Exception as error:
                    results.append(
                        self._failed_result(
                            run_id=run_id,
                            respondent_id=respondent.id,
                            task_id=task.id,
                            task_name=task.name,
                            kind="attitude",
                            error=error,
                        )
                    )
        return results

    def _profile_values(
        self,
        options: list[str],
        multiple: bool,
        respondent: RespondentProfile,
        transcript: str,
    ) -> str | list[str]:
        if not multiple:
            if respondent.income in options:
                return respondent.income
            index = self._stable_index(
                [respondent.id, respondent.city, transcript],
                len(options),
            )
            return options[index]
        count = min(len(options), max(1, 1 + self._stable_index([respondent.id], 3)))
        start = self._stable_index([respondent.occupation, transcript], len(options))
        return [options[(start + offset) % len(options)] for offset in range(count)]

    def _attitude_value(self, options: list[str], transcript: str) -> str:
        positive_markers = ["满意", "方便", "提高", "机会", "保障", "富足"]
        negative_markers = ["压力", "困难", "没有", "不", "焦虑", "房价"]
        positive = sum(marker in transcript for marker in positive_markers)
        negative = sum(marker in transcript for marker in negative_markers)
        if positive > negative and "积极" in options:
            return "积极"
        if negative > positive and "消极" in options:
            return "消极"
        return "中立" if "中立" in options else options[0]

    def _profile_reason(
        self,
        task_name: str,
        respondent: RespondentProfile,
        transcript: str,
    ) -> str:
        return (
            f"根据受访者的城市、职业、收入配置以及访谈中关于生活状态的表达，"
            f"生成“{task_name}”的模拟推断。"
        )

    def _attitude_reason(
        self,
        task_name: str,
        value: str,
        transcript: str,
    ) -> str:
        return (
            f"访谈文本中出现的公共服务、压力、机会和生活体验线索，使“{task_name}”"
            f"被模拟判断为“{value}”。"
        )

    def _evidence(self, session: InterviewSession) -> list[InferenceEvidence]:
        for message in reversed(session.dialog):
            if message.role == "respondent" and message.content.strip():
                excerpt = message.content.strip()
                return [
                    InferenceEvidence(
                        questionId=message.questionId,
                        messageId=message.id,
                        excerpt=excerpt[:120],
                    )
                ]
        return []

    def _stable_index(self, parts: list[str], modulo: int) -> int:
        digest = sha256("\0".join(parts).encode("utf-8")).hexdigest()
        return int(digest[:12], 16) % modulo

    def _failed_result(
        self,
        *,
        run_id: str,
        respondent_id: str,
        task_id: str,
        task_name: str,
        kind: InferenceKind,
        error: Exception,
    ) -> InferenceResult:
        return InferenceResult(
            id=f"inference-{uuid4()}",
            runId=run_id,
            respondentId=respondent_id,
            taskId=task_id,
            taskName=task_name,
            kind=kind,
            value=None,
            reason=None,
            evidence=[],
            status="failed",
            error=str(error),
        )
