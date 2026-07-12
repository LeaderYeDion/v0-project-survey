from __future__ import annotations

from collections import defaultdict

from app.schemas.survey import InferenceResult, InferenceSummaryItem


class InferenceAnalysisService:
    def summarize(
        self,
        results: list[InferenceResult],
    ) -> list[InferenceSummaryItem]:
        grouped: dict[tuple[str, str, str], list[InferenceResult]] = defaultdict(list)
        for result in results:
            grouped[(result.taskId, result.taskName, result.kind)].append(result)

        summaries: list[InferenceSummaryItem] = []
        for (task_id, task_name, kind), items in grouped.items():
            distribution: dict[str, int] = {}
            for item in items:
                if item.status != "completed" or item.value is None:
                    continue
                values = item.value if isinstance(item.value, list) else [item.value]
                for value in values:
                    distribution[value] = distribution.get(value, 0) + 1
            summaries.append(
                InferenceSummaryItem(
                    taskId=task_id,
                    taskName=task_name,
                    kind=kind,
                    total=len(items),
                    completed=sum(item.status == "completed" for item in items),
                    skipped=sum(item.status == "skipped" for item in items),
                    failed=sum(item.status == "failed" for item in items),
                    distribution=distribution,
                )
            )
        return sorted(summaries, key=lambda item: (item.kind, item.taskName))
