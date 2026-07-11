# Interview Inference Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional interview-only profile and attitude inference tasks, using model-ready service boundaries with deterministic mock output.

**Architecture:** Extend the existing survey contract with `inferenceConfig`, `inferenceResults`, and `inferenceSummary`. Add a backend `InferenceService` that runs after each completed interview session and a small analysis helper that summarizes inference output. Frontend changes stay inside the current three-panel workspace: config panel controls tasks, chat panel shows respondent-level details, and analytics panel shows aggregate inference results.

**Tech Stack:** FastAPI, Pydantic, pytest, Next.js App Router, React, TypeScript, ShadCN UI primitives, Recharts, npm test scripts.

## Global Constraints

- Inference is interview-only; survey mode must not run inference even if `inferenceConfig` exists.
- Inference is off by default and existing interview/survey flows must remain unchanged when disabled.
- Custom inference task edits are saved only in the current `SurveyConfig` snapshot.
- The first implementation is mock-backed and must avoid network calls.
- Single inference task failures must not fail the whole run.
- History, JSON export, and CSV export must preserve inference results.
- Documentation must state that inference output is mock simulation, not real research conclusions.
- Do not refactor unrelated layout or analytics code.

---

## File Structure

- Modify `backend/app/schemas/survey.py`: backend Pydantic inference config, result, summary, and snapshot/history fields.
- Create `backend/app/services/inference_service.py`: model-ready service interface plus deterministic mock implementation.
- Create `backend/app/services/inference_analysis_service.py`: summary aggregation for inference results.
- Modify `backend/app/services/run_service.py`: call inference after each interview session and refresh summaries.
- Modify `backend/app/services/export_service.py`: include inference in JSON and CSV exports.
- Modify `backend/app/api/helpers.py`: include inference fields when converting history to a snapshot.
- Modify `backend/app/main.py`: wire inference service dependencies into `RunService`.
- Modify `backend/tests/test_schemas.py`, `backend/tests/test_run_service.py`, `backend/tests/test_api.py`: backend coverage.
- Modify `lib/survey-contract.ts`: frontend contract inference types.
- Modify `components/survey-config-panel.tsx`: interview-only inference task configuration UI.
- Modify `components/chat-simulation-panel.tsx`: respondent-level inference chips and reason/evidence details.
- Modify `components/analytics-panel.tsx`: inference analytics tab.
- Modify `app/page.tsx`: derive display inference results from current run or history and pass them to result panels.
- Modify `lib/i18n/messages.ts`: labels and copy for inference UI.
- Modify `tests/survey-api.test.mjs` or add `tests/inference-contract.test.mjs`: frontend contract/default behavior coverage.
- Modify `README.md` and `docs/PROJECT_ITERATION.md`: document mock inference capability and limitations.

---

### Task 1: Backend Schema And Contract

**Files:**
- Modify: `backend/app/schemas/survey.py`
- Modify: `backend/tests/test_schemas.py`
- Modify: `lib/survey-contract.ts`
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Produces: `InferenceConfig`, `ProfileInferenceTask`, `AttitudeInferenceTask`, `InferenceResult`, `InferenceSummaryItem`, `InferenceEvidence`.
- Produces: optional `SurveyConfig.inferenceConfig`.
- Produces: `RunSnapshot.inferenceResults`, `RunSnapshot.inferenceSummary`, `SurveyHistoryRecord.inferenceResults`, `SurveyHistoryRecord.inferenceSummary`.
- Later tasks consume these exact field names.

- [ ] **Step 1: Write schema tests for backward compatibility and validation**

Add these tests to `backend/tests/test_schemas.py`:

```python
def test_survey_config_accepts_missing_inference_config() -> None:
    config = SurveyConfig(
        title="Interview",
        description="",
        maxResponseTime=30,
        questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
        respondentConfigs=[
            {
                "id": "group-1",
                "gender": "不限",
                "ageRange": "25-35",
                "occupation": "研究员",
                "city": "杭州",
                "income": "20万-50万",
                "count": 1,
            }
        ],
    )

    assert config.inferenceConfig is None


def test_profile_inference_task_requires_options() -> None:
    with pytest.raises(ValidationError):
        SurveyConfig(
            title="Interview",
            description="",
            maxResponseTime=30,
            questions=[SurveyQuestion(id="q1", type="text", question="Why?")],
            respondentConfigs=[
                {
                    "id": "group-1",
                    "gender": "不限",
                    "ageRange": "25-35",
                    "occupation": "研究员",
                    "city": "杭州",
                    "income": "20万-50万",
                    "count": 1,
                }
            ],
            inferenceConfig={
                "enabled": True,
                "profileEnabled": True,
                "attitudeEnabled": False,
                "profileTasks": [
                    {
                        "id": "profile-income",
                        "name": "家庭年收入",
                        "options": [],
                        "multiple": False,
                        "enabled": True,
                    }
                ],
                "attitudeTasks": [],
            },
        )
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pytest backend/tests/test_schemas.py -v
```

Expected: FAIL because `SurveyConfig.inferenceConfig` does not exist.

- [ ] **Step 3: Add backend inference schema types**

In `backend/app/schemas/survey.py`, add imports and models near existing survey models:

```python
InferenceKind = Literal["profile", "attitude"]
InferenceTaskStatus = Literal["completed", "skipped", "failed"]


class ProfileInferenceTask(ApiModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    options: list[str]
    multiple: bool = False
    enabled: bool = True

    @model_validator(mode="after")
    def validate_options(self) -> ProfileInferenceTask:
        if not self.options:
            raise ValueError("profile inference task requires options")
        return self


class AttitudeInferenceTask(ApiModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    options: list[str] = Field(
        default_factory=lambda: ["积极", "中立", "消极"],
    )
    enabled: bool = True

    @model_validator(mode="after")
    def validate_options(self) -> AttitudeInferenceTask:
        if not self.options:
            raise ValueError("attitude inference task requires options")
        return self


class InferenceConfig(ApiModel):
    enabled: bool = False
    profileEnabled: bool = False
    attitudeEnabled: bool = False
    profileTasks: list[ProfileInferenceTask] = Field(default_factory=list)
    attitudeTasks: list[AttitudeInferenceTask] = Field(default_factory=list)


class InferenceEvidence(ApiModel):
    questionId: str | None = None
    messageId: str | None = None
    excerpt: str | None = None


class InferenceResult(ApiModel):
    id: str
    runId: str
    respondentId: str
    taskId: str
    taskName: str
    kind: InferenceKind
    value: str | list[str] | None = None
    reason: str | None = None
    evidence: list[InferenceEvidence] = Field(default_factory=list)
    status: InferenceTaskStatus
    error: str | None = None


class InferenceSummaryItem(ApiModel):
    taskId: str
    taskName: str
    kind: InferenceKind
    total: int
    completed: int
    skipped: int
    failed: int
    distribution: dict[str, int]
```

Add to `SurveyConfig`:

```python
    inferenceConfig: InferenceConfig | None = None
```

Add to `RunSnapshot` and `SurveyHistoryRecord`:

```python
    inferenceResults: list[InferenceResult] = Field(default_factory=list)
    inferenceSummary: list[InferenceSummaryItem] = Field(default_factory=list)
```

Add empty snapshot defaults:

```python
            inferenceResults=[],
            inferenceSummary=[],
```

- [ ] **Step 4: Add frontend contract types**

In `lib/survey-contract.ts`, add:

```ts
export type InferenceKind = "profile" | "attitude"
export type InferenceTaskStatus = "completed" | "skipped" | "failed"

export interface ProfileInferenceTask {
  id: string
  name: string
  options: string[]
  multiple: boolean
  enabled: boolean
}

export interface AttitudeInferenceTask {
  id: string
  name: string
  options: string[]
  enabled: boolean
}

export interface InferenceConfig {
  enabled: boolean
  profileEnabled: boolean
  attitudeEnabled: boolean
  profileTasks: ProfileInferenceTask[]
  attitudeTasks: AttitudeInferenceTask[]
}

export interface InferenceEvidence {
  questionId?: string | null
  messageId?: string | null
  excerpt?: string | null
}

export interface InferenceResult {
  id: string
  runId: string
  respondentId: string
  taskId: string
  taskName: string
  kind: InferenceKind
  value: string | string[] | null
  reason?: string | null
  evidence: InferenceEvidence[]
  status: InferenceTaskStatus
  error?: string | null
}

export interface InferenceSummaryItem {
  taskId: string
  taskName: string
  kind: InferenceKind
  total: number
  completed: number
  skipped: number
  failed: number
  distribution: Record<string, number>
}
```

Add to `SurveyConfig`:

```ts
  inferenceConfig?: InferenceConfig | null
```

Add to `RunSnapshot` and `SurveyHistoryRecord`:

```ts
  inferenceResults: InferenceResult[]
  inferenceSummary: InferenceSummaryItem[]
```

- [ ] **Step 5: Run schema tests and type-aware frontend test subset**

Run:

```bash
pytest backend/tests/test_schemas.py -v
npm test -- tests/survey-api.test.mjs
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/survey.py backend/tests/test_schemas.py lib/survey-contract.ts
git commit -m "feat: add inference contract"
```

---

### Task 2: Backend Inference Service And Run Integration

**Files:**
- Create: `backend/app/services/inference_service.py`
- Create: `backend/app/services/inference_analysis_service.py`
- Modify: `backend/app/services/run_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_run_service.py`
- Test: `backend/tests/test_run_service.py`

**Interfaces:**
- Consumes: schema types from Task 1.
- Produces: `InferenceService.infer_for_session(...) -> list[InferenceResult]`.
- Produces: `InferenceAnalysisService.summarize(results: list[InferenceResult]) -> list[InferenceSummaryItem]`.
- Produces: `RunService(..., inference: InferenceService, inference_analysis: InferenceAnalysisService)`.

- [ ] **Step 1: Write run-service tests for disabled, interview enabled, and survey ignored behavior**

Add tests to `backend/tests/test_run_service.py`:

```python
@pytest.mark.asyncio
async def test_disabled_inference_produces_no_results() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.inferenceConfig = None

    created = await service.create_run(
        CreateRunRequest(mode="interview", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.inferenceResults == []
    assert completed.inferenceSummary == []


@pytest.mark.asyncio
async def test_enabled_interview_inference_generates_results() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.respondentConfigs[0].count = 1
    config.inferenceConfig = {
        "enabled": True,
        "profileEnabled": True,
        "attitudeEnabled": True,
        "profileTasks": [
            {
                "id": "profile-income",
                "name": "家庭年收入",
                "options": ["5万以下", "5万-20万", "20万-50万"],
                "multiple": False,
                "enabled": True,
            }
        ],
        "attitudeTasks": [
            {
                "id": "attitude-common-prosperity",
                "name": "共同富裕倾向",
                "options": ["积极", "中立", "消极"],
                "enabled": True,
            }
        ],
    }

    created = await service.create_run(
        CreateRunRequest(mode="interview", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert len(completed.inferenceResults) == 2
    assert {item.kind for item in completed.inferenceResults} == {
        "profile",
        "attitude",
    }
    assert all(item.status == "completed" for item in completed.inferenceResults)
    assert len(completed.inferenceSummary) == 2


@pytest.mark.asyncio
async def test_survey_mode_ignores_inference_config() -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(3), delay_scale=0),
        analytics=AnalyticsService(catalog),
        inference=InferenceService(random.Random(11)),
        inference_analysis=InferenceAnalysisService(),
    )
    config = catalog.default_template("zh-CN").model_copy(deep=True)
    config.respondentConfigs[0].count = 1
    config.inferenceConfig = {
        "enabled": True,
        "profileEnabled": True,
        "attitudeEnabled": False,
        "profileTasks": [
            {
                "id": "profile-income",
                "name": "家庭年收入",
                "options": ["5万以下", "5万-20万"],
                "multiple": False,
                "enabled": True,
            }
        ],
        "attitudeTasks": [],
    }

    created = await service.create_run(
        CreateRunRequest(mode="survey", config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.inferenceResults == []
    assert completed.inferenceSummary == []
```

Ensure the test imports:

```python
import random
import pytest

from app.mocks.catalog import MockCatalog
from app.mocks.engine import MockEngine
from app.repositories.memory import MemoryRepository
from app.schemas.survey import CreateRunRequest
from app.services.analytics_service import AnalyticsService
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
from app.services.run_service import RunService
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pytest backend/tests/test_run_service.py -v
```

Expected: FAIL because `InferenceService` and `InferenceAnalysisService` do not exist.

- [ ] **Step 3: Implement `InferenceService`**

Create `backend/app/services/inference_service.py`:

```python
from __future__ import annotations

import random
from uuid import uuid4

from app.locales import Locale
from app.schemas.survey import (
    InferenceConfig,
    InferenceEvidence,
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
                        reason=self._profile_reason(task.name, respondent, transcript),
                        evidence=evidence,
                        status="completed",
                    )
                )
        if config.attitudeEnabled:
            for task in config.attitudeTasks:
                if not task.enabled:
                    continue
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
                        reason=self._attitude_reason(task.name, value, transcript),
                        evidence=evidence,
                        status="completed",
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
            index = abs(hash((respondent.id, respondent.city, transcript))) % len(options)
            return options[index]
        count = min(len(options), max(1, 1 + abs(hash(respondent.id)) % 3))
        start = abs(hash((respondent.occupation, transcript))) % len(options)
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
```

- [ ] **Step 4: Implement `InferenceAnalysisService`**

Create `backend/app/services/inference_analysis_service.py`:

```python
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
```

- [ ] **Step 5: Wire inference into `RunService`**

Modify `backend/app/services/run_service.py`.

Add imports:

```python
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
```

Update `__init__`:

```python
    def __init__(
        self,
        repository: MemoryRepository,
        engine: SimulationEngine,
        analytics: AnalyticsService,
        inference: InferenceService | None = None,
        inference_analysis: InferenceAnalysisService | None = None,
    ) -> None:
        self.repository = repository
        self.engine = engine
        self.analytics = analytics
        self.inference = inference or InferenceService()
        self.inference_analysis = inference_analysis or InferenceAnalysisService()
        self._tasks: dict[str, asyncio.Task[None]] = {}
```

Update `_refresh_analytics`:

```python
        snapshot.inferenceSummary = self.inference_analysis.summarize(
            snapshot.inferenceResults
        )
```

Before each session is finalized in `_execute`, after the question loop and before `_refresh_analytics(snapshot)`, add:

```python
                if (
                    snapshot.mode == "interview"
                    and snapshot.config.inferenceConfig is not None
                    and snapshot.config.inferenceConfig.enabled
                ):
                    inference_results = await self.inference.infer_for_session(
                        run_id=snapshot.id,
                        respondent=respondent,
                        session=session,
                        config=snapshot.config.inferenceConfig,
                        locale=snapshot.locale,
                    )
                    snapshot.inferenceResults.extend(inference_results)
```

- [ ] **Step 6: Wire dependencies in `backend/app/main.py`**

Add imports:

```python
from app.services.inference_analysis_service import InferenceAnalysisService
from app.services.inference_service import InferenceService
```

Construct services before `RunService`:

```python
    inference_service = InferenceService()
    inference_analysis_service = InferenceAnalysisService()
    service = run_service or RunService(
        repository=store,
        engine=MockEngine(mock_catalog),
        analytics=analytics_service,
        inference=inference_service,
        inference_analysis=inference_analysis_service,
    )
```

Store them for debugging and tests:

```python
    application.state.inference_service = inference_service
    application.state.inference_analysis = inference_analysis_service
```

- [ ] **Step 7: Run run-service tests**

Run:

```bash
pytest backend/tests/test_run_service.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/inference_service.py backend/app/services/inference_analysis_service.py backend/app/services/run_service.py backend/app/main.py backend/tests/test_run_service.py
git commit -m "feat: run mock interview inference"
```

---

### Task 3: Backend API, History, And Export Preservation

**Files:**
- Modify: `backend/app/api/helpers.py`
- Modify: `backend/app/services/export_service.py`
- Modify: `backend/tests/test_api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: `RunSnapshot.inferenceResults`, `RunSnapshot.inferenceSummary`.
- Produces: history snapshots that retain inference fields.
- Produces: JSON export fields `inferenceResults` and `inferenceSummary`.
- Produces: CSV columns with `.status`, value, and `.reason` columns.

- [ ] **Step 1: Write API test for history and export inference preservation**

Add a helper in `backend/tests/test_api.py`:

```python
def inference_enabled_template() -> dict:
    payload = CATALOG.default_template("en-US").model_dump(mode="json")
    payload["respondentConfigs"][0]["count"] = 1
    payload["inferenceConfig"] = {
        "enabled": True,
        "profileEnabled": True,
        "attitudeEnabled": True,
        "profileTasks": [
            {
                "id": "profile-income",
                "name": "家庭年收入",
                "options": ["5万以下", "5万-20万", "20万-50万"],
                "multiple": False,
                "enabled": True,
            }
        ],
        "attitudeTasks": [
            {
                "id": "attitude-common-prosperity",
                "name": "共同富裕倾向",
                "options": ["积极", "中立", "消极"],
                "enabled": True,
            }
        ],
    }
    return payload
```

Add test:

```python
@pytest.mark.asyncio
async def test_history_and_exports_preserve_inference(
    client: httpx.AsyncClient,
    run_service: RunService,
) -> None:
    created = await client.post(
        "/api/runs",
        headers=LANGUAGE_HEADERS,
        json={
            "mode": "interview",
            "config": inference_enabled_template(),
        },
    )
    assert created.status_code == 201
    run_id = created.json()["id"]
    await run_service.wait(run_id)

    completed = await client.get(f"/api/runs/{run_id}", headers=LANGUAGE_HEADERS)
    assert completed.json()["inferenceResults"]
    assert completed.json()["inferenceSummary"]

    saved = await client.post(
        "/api/history",
        headers=LANGUAGE_HEADERS,
        json={"runId": run_id},
    )
    assert saved.status_code == 201
    assert saved.json()["inferenceResults"]
    history_id = saved.json()["id"]

    history_record = await client.get(
        f"/api/history/{history_id}",
        headers=LANGUAGE_HEADERS,
    )
    assert history_record.json()["inferenceSummary"]

    exported_json = await client.get(
        f"/api/runs/{run_id}/exports",
        headers=LANGUAGE_HEADERS,
        params={"format": "json"},
    )
    assert exported_json.status_code == 200
    assert exported_json.json()["inferenceResults"]

    exported_csv = await client.get(
        f"/api/runs/{run_id}/exports",
        headers=LANGUAGE_HEADERS,
        params={"format": "csv"},
    )
    csv_text = exported_csv.content.decode("utf-8-sig")
    assert "inference.profile.家庭年收入" in csv_text
    assert "inference.attitude.共同富裕倾向.status" in csv_text
```

- [ ] **Step 2: Run API test and verify it fails**

Run:

```bash
pytest backend/tests/test_api.py::test_history_and_exports_preserve_inference -v
```

Expected: FAIL because exports do not include inference fields and `history_as_snapshot` does not copy inference fields.

- [ ] **Step 3: Preserve inference in history snapshot conversion**

Modify `backend/app/api/helpers.py` in `history_as_snapshot`:

```python
        inferenceResults=record.inferenceResults,
        inferenceSummary=record.inferenceSummary,
```

- [ ] **Step 4: Include inference in JSON export**

Modify `backend/app/services/export_service.py` JSON payload:

```python
            "inferenceResults": [
                item.model_dump(mode="json")
                for item in snapshot.inferenceResults
            ],
            "inferenceSummary": [
                item.model_dump(mode="json")
                for item in snapshot.inferenceSummary
            ],
```

- [ ] **Step 5: Include inference in CSV export**

In `backend/app/services/export_service.py`, before writing headers:

```python
        inference_tasks = []
        seen_task_ids: set[str] = set()
        for result in snapshot.inferenceResults:
            if result.taskId in seen_task_ids:
                continue
            seen_task_ids.add(result.taskId)
            inference_tasks.append(result)
```

Replace `writer.writerow([...])` header with:

```python
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
```

Build lookup before iterating sessions:

```python
        inference_by_respondent_task = {
            (item.respondentId, item.taskId): item
            for item in snapshot.inferenceResults
        }
```

Append inference cells to each row:

```python
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
```

Write row as:

```python
                    session.terminationReason or "",
                ]
                + inference_cells
            )
```

- [ ] **Step 6: Run API tests**

Run:

```bash
pytest backend/tests/test_api.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/helpers.py backend/app/services/export_service.py backend/tests/test_api.py
git commit -m "feat: preserve inference in history exports"
```

---

### Task 4: Frontend Inference Config UI

**Files:**
- Modify: `components/survey-config-panel.tsx`
- Modify: `lib/i18n/messages.ts`
- Add: `tests/inference-contract.test.mjs`
- Test: `tests/inference-contract.test.mjs`

**Interfaces:**
- Consumes: `InferenceConfig`, `ProfileInferenceTask`, `AttitudeInferenceTask`.
- Produces: `createDefaultInferenceConfig(): InferenceConfig` exported from `lib/survey-contract.ts`.
- Produces: `SurveyConfigPanel` can edit `config.inferenceConfig`.

- [ ] **Step 1: Add frontend default config tests**

Create `tests/inference-contract.test.mjs`:

```js
import assert from "node:assert/strict"
import { test } from "node:test"
import { createDefaultInferenceConfig } from "../lib/survey-contract.ts"

test("default inference config is disabled with editable presets", () => {
  const config = createDefaultInferenceConfig()

  assert.equal(config.enabled, false)
  assert.equal(config.profileEnabled, false)
  assert.equal(config.attitudeEnabled, false)
  assert.ok(config.profileTasks.some(task => task.name === "家庭年收入"))
  assert.ok(config.profileTasks.some(task => task.multiple === true))
  assert.ok(config.attitudeTasks.some(task => task.name === "共同富裕倾向"))
  assert.deepEqual(config.attitudeTasks[0].options, ["积极", "中立", "消极"])
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/inference-contract.test.mjs
```

Expected: FAIL because `createDefaultInferenceConfig` is not exported.

- [ ] **Step 3: Add default inference config helper**

In `lib/survey-contract.ts`, export:

```ts
export function createDefaultInferenceConfig(): InferenceConfig {
  return {
    enabled: false,
    profileEnabled: false,
    attitudeEnabled: false,
    profileTasks: [
      {
        id: "profile-income",
        name: "家庭年收入",
        options: ["5万以下", "5万-20万", "20万-50万", "50万-100万", "100万以上"],
        multiple: false,
        enabled: true,
      },
      {
        id: "profile-family-members",
        name: "家庭成员关系",
        options: ["父母", "配偶", "子女", "兄弟姐妹", "祖父母/外祖父母", "孙子女/外孙子女", "其他亲属", "其他非亲属"],
        multiple: true,
        enabled: true,
      },
      {
        id: "profile-monthly-spending",
        name: "家庭月消费主要支出项目",
        options: ["住房支出（房贷、租房等）", "日常生活消费（食品、衣物等）", "教育支出（学费、教辅等）", "交通支出（交通工具、油费、公交等）", "医疗健康支出（医疗保险、药品、就医等）", "休闲娱乐消费（旅游、娱乐、外出就餐等）", "其他家庭支出"],
        multiple: true,
        enabled: true,
      },
    ],
    attitudeTasks: [
      {
        id: "attitude-common-prosperity",
        name: "共同富裕倾向",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-public-service",
        name: "公共服务评价",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-upward-mobility",
        name: "向上流动倾向",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-parent-comparison",
        name: "和父辈相比",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
    ],
  }
}
```

- [ ] **Step 4: Add inference messages**

In `lib/i18n/messages.ts`, add Chinese and English labels under `config`, using existing message object style:

```ts
inferenceTasks: "推断任务",
inferenceDescription: "仅访谈模式可用，默认不运行",
profileInference: "画像推断",
attitudeInference: "态度判断",
addProfileTask: "新增画像字段",
addAttitudeTask: "新增态度标签",
taskName: "任务名称",
taskOptions: "可选值（每行一个）",
allowMultipleValues: "允许多选",
```

Use equivalent English labels for `en-US`.

- [ ] **Step 5: Add config panel helpers**

In `components/survey-config-panel.tsx`, update imports:

```ts
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import type {
  SurveyConfig,
  SurveyQuestion,
  RespondentConfig,
  InferenceConfig,
  ProfileInferenceTask,
  AttitudeInferenceTask,
} from "@/lib/survey-api"
import { createDefaultInferenceConfig } from "@/lib/survey-api"
```

Add helpers inside `SurveyConfigPanel`:

```ts
  const inferenceConfig = config.inferenceConfig ?? createDefaultInferenceConfig()

  const updateInferenceConfig = (updates: Partial<InferenceConfig>) => {
    const nextConfig = { ...inferenceConfig, ...updates }
    onConfigChange({ ...config, inferenceConfig: nextConfig })
  }

  const updateProfileTask = (index: number, updates: Partial<ProfileInferenceTask>) => {
    const profileTasks = [...inferenceConfig.profileTasks]
    profileTasks[index] = { ...profileTasks[index], ...updates }
    updateInferenceConfig({ profileTasks })
  }

  const updateAttitudeTask = (index: number, updates: Partial<AttitudeInferenceTask>) => {
    const attitudeTasks = [...inferenceConfig.attitudeTasks]
    attitudeTasks[index] = { ...attitudeTasks[index], ...updates }
    updateInferenceConfig({ attitudeTasks })
  }

  const addProfileTask = () => {
    updateInferenceConfig({
      profileTasks: [
        ...inferenceConfig.profileTasks,
        {
          id: `profile-${Date.now()}`,
          name: "",
          options: ["选项1", "选项2"],
          multiple: false,
          enabled: true,
        },
      ],
    })
  }

  const addAttitudeTask = () => {
    updateInferenceConfig({
      attitudeTasks: [
        ...inferenceConfig.attitudeTasks,
        {
          id: `attitude-${Date.now()}`,
          name: "",
          options: ["积极", "中立", "消极"],
          enabled: true,
        },
      ],
    })
  }
```

- [ ] **Step 6: Render interview-only inference accordion**

In `components/survey-config-panel.tsx`, after respondent config accordion and before closing the form content, add:

```tsx
            {mode === "interview" && (
              <Accordion type="single" collapsible>
                <AccordionItem
                  value="inference-tasks"
                  className="rounded-lg border border-border/30 bg-secondary/10"
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-primary" />
                        <span className="font-medium text-foreground">
                          {messages.config.inferenceTasks}
                        </span>
                      </div>
                      <Badge variant="secondary" className="bg-primary/20 text-primary">
                        {inferenceConfig.enabled ? messages.common.enabled : messages.common.disabled}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 px-4 pb-4">
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border/30 bg-background/40 p-3">
                      <div>
                        <Label className="text-sm text-foreground">
                          {messages.config.inferenceTasks}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {messages.config.inferenceDescription}
                        </p>
                      </div>
                      <Switch
                        checked={inferenceConfig.enabled}
                        onCheckedChange={(enabled) => updateInferenceConfig({ enabled })}
                      />
                    </div>

                    {inferenceConfig.enabled && (
                      <div className="space-y-4">
                        <InferenceTaskGroup
                          title={messages.config.profileInference}
                          enabled={inferenceConfig.profileEnabled}
                          onEnabledChange={(profileEnabled) => updateInferenceConfig({ profileEnabled })}
                          onAdd={addProfileTask}
                          addLabel={messages.config.addProfileTask}
                        >
                          {inferenceConfig.profileTasks.map((task, index) => (
                            <InferenceTaskEditor
                              key={task.id}
                              name={task.name}
                              enabled={task.enabled}
                              options={task.options}
                              multiple={task.multiple}
                              showMultiple
                              onNameChange={(name) => updateProfileTask(index, { name })}
                              onEnabledChange={(enabled) => updateProfileTask(index, { enabled })}
                              onOptionsChange={(options) => updateProfileTask(index, { options })}
                              onMultipleChange={(multiple) => updateProfileTask(index, { multiple })}
                              onRemove={() =>
                                updateInferenceConfig({
                                  profileTasks: inferenceConfig.profileTasks.filter((_, taskIndex) => taskIndex !== index),
                                })
                              }
                            />
                          ))}
                        </InferenceTaskGroup>

                        <InferenceTaskGroup
                          title={messages.config.attitudeInference}
                          enabled={inferenceConfig.attitudeEnabled}
                          onEnabledChange={(attitudeEnabled) => updateInferenceConfig({ attitudeEnabled })}
                          onAdd={addAttitudeTask}
                          addLabel={messages.config.addAttitudeTask}
                        >
                          {inferenceConfig.attitudeTasks.map((task, index) => (
                            <InferenceTaskEditor
                              key={task.id}
                              name={task.name}
                              enabled={task.enabled}
                              options={task.options}
                              onNameChange={(name) => updateAttitudeTask(index, { name })}
                              onEnabledChange={(enabled) => updateAttitudeTask(index, { enabled })}
                              onOptionsChange={(options) => updateAttitudeTask(index, { options })}
                              onRemove={() =>
                                updateInferenceConfig({
                                  attitudeTasks: inferenceConfig.attitudeTasks.filter((_, taskIndex) => taskIndex !== index),
                                })
                              }
                            />
                          ))}
                        </InferenceTaskGroup>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
```

Add local helper components at the bottom of the file:

```tsx
function InferenceTaskGroup({
  title,
  enabled,
  onEnabledChange,
  onAdd,
  addLabel,
  children,
}: {
  title: string
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  onAdd: () => void
  addLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/30 bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
          <Label className="text-sm text-foreground">{title}</Label>
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          {addLabel}
        </Button>
      </div>
      {enabled && <div className="space-y-3">{children}</div>}
    </div>
  )
}

function InferenceTaskEditor({
  name,
  enabled,
  options,
  multiple,
  showMultiple = false,
  onNameChange,
  onEnabledChange,
  onOptionsChange,
  onMultipleChange,
  onRemove,
}: {
  name: string
  enabled: boolean
  options: string[]
  multiple?: boolean
  showMultiple?: boolean
  onNameChange: (name: string) => void
  onEnabledChange: (enabled: boolean) => void
  onOptionsChange: (options: string[]) => void
  onMultipleChange?: (multiple: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/30 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={enabled} onCheckedChange={(value) => onEnabledChange(value === true)} />
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="h-8 bg-background/50 text-xs"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Textarea
        value={options.join("\n")}
        onChange={(event) =>
          onOptionsChange(
            event.target.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        className="min-h-20 bg-background/50 text-xs"
      />
      {showMultiple && onMultipleChange && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={multiple} onCheckedChange={(value) => onMultipleChange(value === true)} />
          允许多选
        </label>
      )}
    </div>
  )
}
```

Add `ReactNode` to the imports:

```ts
import { useState, type ReactNode } from "react"
```

Use `ReactNode` in the helper component props:

```ts
  children: ReactNode
```

- [ ] **Step 7: Run frontend contract test and lint/type checks**

Run:

```bash
npm test -- tests/inference-contract.test.mjs
npm run lint
```

Expected: PASS. If `npm run lint` is not configured, run `npm test -- tests/i18n.test.mjs` and record the missing lint script in the task notes.

- [ ] **Step 8: Commit**

```bash
git add lib/survey-contract.ts components/survey-config-panel.tsx lib/i18n/messages.ts tests/inference-contract.test.mjs
git commit -m "feat: configure interview inference tasks"
```

---

### Task 5: Frontend Result Presentation

**Files:**
- Modify: `components/chat-simulation-panel.tsx`
- Modify: `components/analytics-panel.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/i18n/messages.ts`
- Test: `tests/inference-contract.test.mjs`

**Interfaces:**
- Consumes: `InferenceResult[]` and `InferenceSummaryItem[]`.
- Produces: `ChatSimulationPanel` prop `inferenceResults: InferenceResult[]`.
- Produces: `AnalyticsPanel` props `inferenceResults: InferenceResult[]`, `inferenceSummary: InferenceSummaryItem[]`.

- [ ] **Step 1: Add utility test for value rendering**

Append to `tests/inference-contract.test.mjs`:

```js
import { renderInferenceValue } from "../lib/survey-contract.ts"

test("renderInferenceValue handles scalar, multi-value, and empty values", () => {
  assert.equal(renderInferenceValue("积极"), "积极")
  assert.equal(renderInferenceValue(["父母", "子女"]), "父母、子女")
  assert.equal(renderInferenceValue(null), "")
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- tests/inference-contract.test.mjs
```

Expected: FAIL because `renderInferenceValue` is not exported.

- [ ] **Step 3: Add inference value renderer**

In `lib/survey-contract.ts`, export:

```ts
export function renderInferenceValue(value: string | string[] | null): string {
  if (Array.isArray(value)) {
    return value.join("、")
  }
  return value ?? ""
}
```

- [ ] **Step 4: Update `ChatSimulationPanel` props and selected respondent details**

In `components/chat-simulation-panel.tsx`, import:

```ts
import type { InferenceResult, InterviewSession, RespondentProfile } from "@/lib/survey-contract"
import { renderInferenceValue } from "@/lib/survey-contract"
```

Update props:

```ts
  inferenceResults: InferenceResult[]
```

Update function parameters:

```ts
  inferenceResults,
```

Compute selected inference results:

```ts
  const selectedInferenceResults = inferenceResults.filter(
    result => result.respondentId === selectedRespondentId,
  )
```

After respondent tags in the selected respondent info block, add:

```tsx
                  {selectedInferenceResults.length > 0 && (
                    <div className="mt-3 space-y-2 rounded-md border border-border/30 bg-background/40 p-2">
                      <div className="text-[11px] font-medium text-muted-foreground">
                        {messages.interview.inferenceResults}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedInferenceResults.map((result) => (
                          <Badge
                            key={result.id}
                            variant="outline"
                            className="max-w-full border-primary/30 bg-primary/10 text-[10px] text-primary"
                            title={result.reason || result.error || undefined}
                          >
                            {result.taskName}: {renderInferenceValue(result.value) || result.status}
                          </Badge>
                        ))}
                      </div>
                      <div className="space-y-1">
                        {selectedInferenceResults.map((result) => (
                          <p key={`${result.id}-reason`} className="text-xs leading-relaxed text-muted-foreground">
                            {result.taskName}: {result.reason || result.error || result.status}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
```

- [ ] **Step 5: Update `AnalyticsPanel` props and inference tab**

In `components/analytics-panel.tsx`, add imports:

```ts
  InferenceResult,
  InferenceSummaryItem,
```

Add props:

```ts
  inferenceResults: InferenceResult[]
  inferenceSummary: InferenceSummaryItem[]
```

Update function parameters:

```ts
  inferenceResults,
  inferenceSummary,
```

Change tab grid from `sm:grid-cols-3` to `sm:grid-cols-4`, then add trigger:

```tsx
              <TabsTrigger value="inference" className="min-h-9 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight">
                {messages.analytics.inference}
              </TabsTrigger>
```

Add content before closing `Tabs`:

```tsx
            <TabsContent value="inference" className="mt-4 space-y-4">
              {inferenceSummary.length === 0 ? (
                <div className="rounded-lg border border-border/30 bg-secondary/20 p-4 text-sm text-muted-foreground">
                  {messages.analytics.noInferenceResults}
                </div>
              ) : (
                <>
                  <div className="grid gap-3">
                    {inferenceSummary.map((item) => (
                      <div key={item.taskId} className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-medium text-foreground">{item.taskName}</h4>
                            <p className="text-xs text-muted-foreground">
                              {item.completed}/{item.total} completed · {item.failed} failed
                            </p>
                          </div>
                          <Badge variant="outline">{item.kind}</Badge>
                        </div>
                        <div className="space-y-1">
                          {Object.entries(item.distribution).map(([value, count]) => (
                            <div key={value} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-muted-foreground">{value}</span>
                              <span className="font-medium text-foreground">{formatInteger(locale, count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-auto rounded-lg border border-border/30">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border/30 text-left text-muted-foreground">
                          <th className="p-2">Respondent</th>
                          <th className="p-2">Task</th>
                          <th className="p-2">Value</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inferenceResults.map((result) => {
                          const respondent = respondents.find(item => item.id === result.respondentId)
                          return (
                            <tr key={result.id} className="border-b border-border/20">
                              <td className="p-2 text-muted-foreground">{respondent?.name || result.respondentId}</td>
                              <td className="p-2 text-muted-foreground">{result.taskName}</td>
                              <td className="p-2 text-foreground">{Array.isArray(result.value) ? result.value.join("、") : result.value || ""}</td>
                              <td className="p-2 text-muted-foreground">{result.status}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>
```

- [ ] **Step 6: Pass inference props from `app/page.tsx`**

In `app/page.tsx`, add display values after `displayResponses`:

```ts
  const displayInferenceResults =
    viewingHistoryRecord?.inferenceResults ?? currentRun?.inferenceResults ?? []
  const displayInferenceSummary =
    viewingHistoryRecord?.inferenceSummary ?? currentRun?.inferenceSummary ?? []
```

Find `ChatSimulationPanel` usage and add:

```tsx
inferenceResults={displayInferenceResults}
```

Find `AnalyticsPanel` usage and add:

```tsx
inferenceResults={displayInferenceResults}
inferenceSummary={displayInferenceSummary}
```

- [ ] **Step 7: Add messages**

In `lib/i18n/messages.ts`, add:

```ts
interview: {
  inferenceResults: "推断结果",
}
analytics: {
  inference: "推断",
  noInferenceResults: "暂无推断结果",
}
```

Use equivalent English strings in `en-US`.

- [ ] **Step 8: Run frontend tests**

Run:

```bash
npm test -- tests/inference-contract.test.mjs tests/i18n.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/chat-simulation-panel.tsx components/analytics-panel.tsx app/page.tsx lib/i18n/messages.ts lib/survey-contract.ts tests/inference-contract.test.mjs
git commit -m "feat: show interview inference results"
```

---

### Task 6: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`
- Test: full backend and frontend test suites

**Interfaces:**
- Consumes: completed implementation from Tasks 1-5.
- Produces: updated project docs stating mock inference limitations.

- [ ] **Step 1: Update README**

In `README.md`, update the business logic section to include:

```markdown
- **访谈推断任务（Mock）**：访谈模式可在运行前启用画像推断和态度判断，基于访谈文本生成受访者字段、态度标签、理由和证据引用；当前由 FastAPI Mock 服务生成，不代表真实模型或真实研究结论。
```

Update the current-stage paragraph to mention mock inference:

```markdown
调研编排、Mock 回答、访谈推断、历史、统计和导出已从前端迁移至 `backend/`；它尚未接入真实 AI 模型...
```

- [ ] **Step 2: Update project iteration doc**

In `docs/PROJECT_ITERATION.md`, add a new dated entry for 2026-07-11 with:

```markdown
### 2026-07-11 Interview Inference Tasks

- 目标：支持访谈后的画像推断和态度判断，并保持默认关闭。
- 完成：新增访谈配置中的推断任务、Mock 推断服务、推断汇总、受访者明细、history/export 保留。
- 验证：记录 backend pytest、frontend tests 和 build 命令结果。
- 遗留：推断仍为 Mock 输出；真实模型接入、全局预设管理和独立导入推断留待后续。
```

- [ ] **Step 3: Run full backend tests**

Run:

```bash
pytest backend/tests -v
```

Expected: PASS.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/PROJECT_ITERATION.md
git commit -m "docs: document mock interview inference"
```

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: only pre-existing unrelated user changes remain, especially the existing `.gitignore` modification if the user has not handled it.
