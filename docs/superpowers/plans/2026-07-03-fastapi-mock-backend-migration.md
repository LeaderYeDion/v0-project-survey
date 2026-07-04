# FastAPI Mock Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all production Mock survey orchestration, response generation, analytics, history, and export logic from the Next.js client into a Python 3.14.6 FastAPI backend while preserving the current UI and visible behavior.

**Architecture:** The browser calls same-origin `/survey-api/*`; a Next.js rewrite forwards requests to FastAPI `/api/*`. FastAPI owns an in-memory repository and application-local asynchronous run tasks. The frontend creates a run, polls complete render snapshots, sends analytics query parameters, and renders returned data without computing business results.

**Tech Stack:** Python 3.14.6, FastAPI, Pydantic 2, Uvicorn, pytest, pytest-asyncio, HTTPX, Next.js 16, React 19, TypeScript 5.7.

---

## File map

### Backend files to create

- `backend/.python-version` — pins Python 3.14.6.
- `backend/requirements.txt` — runtime dependencies.
- `backend/requirements-dev.txt` — test dependencies.
- `backend/scripts/bootstrap.sh` — installs a project-local Python and creates `.venv`.
- `backend/scripts/dev-full.sh` — starts FastAPI and Next.js and cleans both up on exit.
- `backend/app/main.py` — FastAPI application and router registration.
- `backend/app/schemas/survey.py` — survey, respondent, session, answer, run, and history schemas.
- `backend/app/schemas/analytics.py` — dimension query and result schemas.
- `backend/app/repositories/memory.py` — in-memory run and history repository.
- `backend/app/services/mock_engine.py` — respondent and response Mock generation.
- `backend/app/services/analytics_service.py` — all analytics, filtering, grouping, and response building.
- `backend/app/services/run_service.py` — run lifecycle and async orchestration.
- `backend/app/services/export_service.py` — JSON and CSV serialization.
- `backend/app/api/templates.py` — default template endpoint.
- `backend/app/api/runs.py` — create, read, and cancel run endpoints.
- `backend/app/api/history.py` — save, list, and read history endpoints.
- `backend/app/api/analytics.py` — current-run and history analytics endpoints.
- `backend/app/api/exports.py` — current-run and history export endpoints.
- `backend/tests/conftest.py` — isolated test application and deterministic services.
- `backend/tests/test_schemas.py` — schema validation tests.
- `backend/tests/test_mock_engine.py` — Mock behavior tests.
- `backend/tests/test_analytics_service.py` — analytics tests.
- `backend/tests/test_run_service.py` — lifecycle and orchestration tests.
- `backend/tests/test_api.py` — HTTP contract tests.
- `backend/README.md` — backend setup and operation guide.

Every Python package directory receives an empty `__init__.py`.

### Frontend files to create

- `lib/survey-contract.ts` — TypeScript API contract without implementation.

### Frontend files to modify

- `.gitignore` — ignore backend-local runtime and virtual environment.
- `next.config.mjs` — same-origin backend rewrite.
- `package.json` — backend/full-stack development commands and typecheck.
- `lib/survey-api.ts` — real HTTP client.
- `app/page.tsx` — create and poll backend runs.
- `components/analytics-panel.tsx` — request backend analytics and history.
- `components/chat-simulation-panel.tsx` — import types from the shared contract.
- `docs/PROJECT_ITERATION.md` — record this migration.
- `README.md` — document full-stack development and first-version limitations.

### Frontend file to delete

- `lib/mock-survey-service.ts` — removed after production imports and logic are migrated.

## Task 1: Python 3.14.6 environment and FastAPI skeleton

**Files:**

- Modify: `.gitignore`
- Modify: `package.json`
- Create: `backend/.python-version`
- Create: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Create: `backend/scripts/bootstrap.sh`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/test_health.py`

- [ ] **Step 1: Record the pre-migration browser baseline**

Start the current frontend, use the browser automation skill at
`http://127.0.0.1:3000`, and save desktop screenshots for:

- mode selection;
- survey configuration;
- a completed survey result;
- analytics overview;
- interview respondent/conversation view.

Store screenshots under `/tmp/v0-project-survey-baseline/` so generated binary
artifacts are not committed.

- [ ] **Step 2: Add the failing health test**

```python
# backend/tests/test_health.py
import sys

from fastapi.testclient import TestClient

from app.main import app


def test_health_reports_service_and_python_version() -> None:
    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "survey-mock-backend",
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
    }
```

- [ ] **Step 3: Add environment manifests and bootstrap script**

```text
# backend/.python-version
3.14.6
```

```text
# backend/requirements.txt
fastapi==0.139.0
pydantic==2.13.4
uvicorn[standard]==0.49.0
```

```text
# backend/requirements-dev.txt
-r requirements.txt
httpx==0.28.1
pytest==9.1.1
pytest-asyncio==1.4.0
```

```bash
#!/usr/bin/env bash
set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uv_bin="$backend_dir/.tools/uv"
python_dir="$backend_dir/.python"

mkdir -p "$backend_dir/.tools" "$python_dir"
if [[ ! -x "$uv_bin" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh |
    env UV_UNMANAGED_INSTALL="$backend_dir/.tools" sh
fi

UV_PYTHON_INSTALL_DIR="$python_dir" "$uv_bin" python install 3.14.6
python_bin="$(UV_PYTHON_INSTALL_DIR="$python_dir" "$uv_bin" python find 3.14.6)"
"$python_bin" -m venv "$backend_dir/.venv"
"$backend_dir/.venv/bin/python" -m pip install --upgrade pip
"$backend_dir/.venv/bin/python" -m pip install -r "$backend_dir/requirements-dev.txt"
"$backend_dir/.venv/bin/python" -c \
  'import sys; assert sys.version_info[:3] == (3, 14, 6), sys.version'
```

- [ ] **Step 4: Run bootstrap and verify the test fails because the app is absent**

Run:

```bash
bash backend/scripts/bootstrap.sh
backend/.venv/bin/python -m pytest backend/tests/test_health.py -v
```

Expected: environment assertion passes; pytest fails importing `app.main`.

- [ ] **Step 5: Add the minimal FastAPI application**

```python
# backend/app/main.py
import sys

from fastapi import FastAPI

app = FastAPI(title="Survey Mock Backend", version="0.1.0")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "survey-mock-backend",
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
    }
```

Add these ignore entries:

```gitignore
backend/.python/
backend/.tools/
backend/.venv/
backend/.pytest_cache/
backend/**/__pycache__/
backend/**/*.pyc
```

Add scripts:

```json
"typecheck": "tsc --noEmit",
"dev:backend": "cd backend && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000",
"dev:full": "bash backend/scripts/dev-full.sh"
```

- [ ] **Step 6: Run the health test and version assertions**

Run:

```bash
backend/.venv/bin/python --version
backend/.venv/bin/python -m pip --version
backend/.venv/bin/python -m pytest backend/tests/test_health.py -v
```

Expected: Python `3.14.6`; pip resolves inside `backend/.venv`; `1 passed`.

- [ ] **Step 7: Commit the environment skeleton**

```bash
git add .gitignore package.json backend
git commit -m "build: initialize Python 3.14 FastAPI backend"
```

## Task 2: Pydantic and TypeScript contracts

**Files:**

- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/survey.py`
- Create: `backend/app/schemas/analytics.py`
- Create: `backend/tests/test_schemas.py`
- Create: `lib/survey-contract.ts`

- [ ] **Step 1: Write failing schema validation tests**

```python
# backend/tests/test_schemas.py
import pytest
from pydantic import ValidationError

from app.schemas.survey import CreateRunRequest, SurveyConfig, SurveyQuestion


def test_choice_question_requires_options() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestion(id="q1", type="choice", question="选择？", options=[])


def test_scale_question_requires_ordered_range() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestion(
            id="q1",
            type="scale",
            question="评分？",
            scale={"min": 10, "max": 1},
        )


def test_run_requires_questions_and_respondents() -> None:
    with pytest.raises(ValidationError):
        CreateRunRequest(
            mode="survey",
            config=SurveyConfig(
                title="空调研",
                description="",
                maxResponseTime=30,
                questions=[],
                respondentConfigs=[],
            ),
        )
```

- [ ] **Step 2: Run tests to confirm missing schemas**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_schemas.py -v
```

Expected: FAIL importing `app.schemas.survey`.

- [ ] **Step 3: Implement the complete API schemas**

Implement `backend/app/schemas/survey.py` with:

```python
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

QuestionType = Literal["text", "choice", "scale"]
SessionStatus = Literal[
    "pending",
    "in_progress",
    "completed",
    "terminated_by_respondent",
    "terminated_by_interviewer",
]
RunStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
SimulationMode = Literal["interview", "survey"]
Sentiment = Literal["positive", "neutral", "negative"]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ScaleRange(ApiModel):
    min: int
    max: int

    @model_validator(mode="after")
    def validate_range(self) -> "ScaleRange":
        if self.min >= self.max:
            raise ValueError("scale.min must be less than scale.max")
        return self


class SurveyQuestion(ApiModel):
    id: str = Field(min_length=1)
    type: QuestionType
    question: str
    options: list[str] | None = None
    scale: ScaleRange | None = None

    @model_validator(mode="after")
    def validate_type_fields(self) -> "SurveyQuestion":
        if self.type == "choice" and not self.options:
            raise ValueError("choice question requires options")
        if self.type == "scale" and self.scale is None:
            raise ValueError("scale question requires scale")
        return self


class RespondentConfig(ApiModel):
    id: str
    gender: str
    ageRange: str
    occupation: str
    city: str
    income: str
    count: Annotated[int, Field(gt=0)]


class SurveyConfig(ApiModel):
    title: str
    description: str
    questions: list[SurveyQuestion]
    maxResponseTime: Annotated[int, Field(gt=0)]
    respondentConfigs: list[RespondentConfig]

    @model_validator(mode="after")
    def validate_non_empty(self) -> "SurveyConfig":
        if not self.questions:
            raise ValueError("survey requires at least one question")
        if not self.respondentConfigs:
            raise ValueError("survey requires respondent configs")
        return self
```

Continue in the same file with the exact camelCase models from the design:

- `RespondentProfile`
- `DialogMessage`
- `InterviewSession`
- discriminated answer models `TextAnswer`, `ChoiceAnswer`, `ScaleAnswer`
- `SurveyResponse`
- `SurveyProgress`
- `SentimentData`
- `QuestionAnalysis`
- `DemographicAnalysis`
- `CreateRunRequest`
- `RunSnapshot`
- `SurveyHistoryRecord`
- `CreateHistoryRequest`

Use `datetime` fields so Pydantic emits ISO 8601 JSON. Use `Field(discriminator="type")` for answer unions. `RunSnapshot` includes every field listed in design section 7.3.

Implement `backend/app/schemas/analytics.py`:

```python
from typing import Literal

from pydantic import Field

from app.schemas.survey import ApiModel, QuestionAnalysis

DimensionKey = Literal["gender", "ageRange", "occupation", "city", "income"]


class AnalyticsQuery(ApiModel):
    questionId: str
    filters: dict[DimensionKey, str] = Field(default_factory=dict)
    groupBy: list[DimensionKey] = Field(default_factory=list)


class DimensionMetadata(ApiModel):
    key: DimensionKey
    label: str
    values: list[str]


class GroupedQuestionSummary(ApiModel):
    label: str
    respondentCount: int
    totalResponses: int
    analysis: QuestionAnalysis | None


class AnalyticsQueryResult(ApiModel):
    dimensionMetadata: list[DimensionMetadata]
    filteredRespondentCount: int
    totalRespondentCount: int
    filteredQuestionAnalysis: QuestionAnalysis | None
    groupedQuestionSummaries: list[GroupedQuestionSummary]
```

- [ ] **Step 4: Add the matching TypeScript contract**

Move all interfaces and type aliases from `lib/mock-survey-service.ts` into `lib/survey-contract.ts`. Add:

```ts
export type SimulationMode = "interview" | "survey"
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface RunSnapshot {
  id: string
  mode: SimulationMode
  status: RunStatus
  config: SurveyConfig
  respondents: RespondentProfile[]
  sessions: InterviewSession[]
  progress: SurveyProgress
  sentiment: SentimentData
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  responses: SurveyResponse[]
  activeRespondentId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}
```

Use `string` rather than `Date` for every HTTP timestamp. Add `AnalyticsQuery`, `DimensionMetadata`, `GroupedQuestionSummary`, and `AnalyticsQueryResult` matching Python fields exactly.

- [ ] **Step 5: Run schema tests and TypeScript checking**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_schemas.py -v
npm run typecheck
```

Expected: schema tests and the existing frontend TypeScript check pass; adding
the standalone contract does not change existing imports yet.

- [ ] **Step 6: Commit contracts**

```bash
git add backend/app/schemas backend/tests/test_schemas.py lib/survey-contract.ts
git commit -m "feat: define survey backend contracts"
```

## Task 3: Default template and deterministic Mock engine

**Files:**

- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/mock_engine.py`
- Create: `backend/tests/test_mock_engine.py`

- [ ] **Step 1: Write failing Mock engine tests**

```python
# backend/tests/test_mock_engine.py
import random

from app.schemas.survey import RespondentConfig, SurveyQuestion
from app.services.mock_engine import MockEngine, default_survey_config


def test_default_template_matches_existing_demo() -> None:
    config = default_survey_config()
    assert config.title == "用户体验调研"
    assert len(config.questions) == 5
    assert sum(item.count for item in config.respondentConfigs) == 7


def test_generate_respondents_honors_count_and_config() -> None:
    engine = MockEngine(random.Random(1), delay_scale=0)
    respondents = engine.generate_respondents(
        [
            RespondentConfig(
                id="group-1",
                gender="男",
                ageRange="25-35",
                occupation="产品经理",
                city="北京",
                income="20-30万",
                count=3,
            )
        ]
    )
    assert len(respondents) == 3
    assert {item.gender for item in respondents} == {"男"}
    assert {item.configId for item in respondents} == {"group-1"}


def test_text_answer_keeps_text_type() -> None:
    engine = MockEngine(random.Random(2), delay_scale=0)
    respondent = engine.generate_respondents(default_survey_config().respondentConfigs)[0]
    message = engine.generate_answer(
        respondent,
        SurveyQuestion(id="text-1", type="text", question="建议？"),
    )
    assert message.answerValue is not None
    assert message.answerValue.type == "text"
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_mock_engine.py -v
```

Expected: FAIL importing `MockEngine`.

- [ ] **Step 3: Port default data and respondent generation**

In `mock_engine.py`, define the same name, nickname, education, marital status, avatar, termination phrase, scale response, choice response, and text response pools currently present in `lib/mock-survey-service.ts`.

Implement `MockEngine` with these exact rules:

- Constructor accepts `rng: random.Random | None` and `delay_scale: float`; use
  `random.Random()` when no generator is supplied.
- `generate_respondents(configs)` iterates each config `count` times, parses
  `ageRange` with `r"(\d+)[-~](\d+)"`, selects gender, demographic values and
  names with `self.rng`, builds the existing age/income/occupation tags, and
  assigns UUID-backed `respondent-<uuid>` IDs.
- `generate_answer(respondent, question)` samples sentiment with weights
  `0.4/0.35/0.25`, uses the existing Chinese response templates, and returns a
  `DialogMessage` containing the typed answer matching `question.type`.
- `respondent_should_terminate(previous_dialog)` returns true only when there
  are more than two prior messages and the sampled value is below `0.1`.
- `response_is_low_quality(previous_dialog)` returns true only when there are
  more than four prior messages and the sampled value is below `0.15`.
- `interviewer_should_terminate(dialog, low_quality)` applies the existing
  50% low-quality rule, then the existing three-negative-message and 30% rule.
- `async wait(seconds)` calls `asyncio.sleep(seconds * delay_scale)`, allowing
  tests to use `delay_scale=0`.

`generate_answer` must attach a typed `answerValue`; display `content` must stay equivalent to the existing Chinese templates.

- [ ] **Step 4: Run deterministic Mock tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_mock_engine.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit the Mock engine**

```bash
git add backend/app/services backend/tests/test_mock_engine.py
git commit -m "feat: move mock respondent and answer generation to backend"
```

## Task 4: Analytics, filtering, grouping, and response building

**Files:**

- Create: `backend/app/services/analytics_service.py`
- Create: `backend/tests/test_analytics_service.py`

- [ ] **Step 1: Write failing analytics tests**

Build two respondents, two questions, and completed sessions with known answers. Assert:

```python
def test_question_analysis_and_typed_responses(sample_dataset) -> None:
    service = AnalyticsService()
    result = service.analyze_questions(
        sample_dataset.sessions,
        sample_dataset.questions,
    )
    assert result[0].totalResponses == 2
    assert result[0].averageScore == 7.0
    assert result[0].responseDistribution == {"6": 1, "8": 1}

    responses = service.build_responses(
        sample_dataset.sessions,
        "survey-1",
        sample_dataset.questions,
    )
    assert responses[0].answers["text-1"].type == "text"


def test_filter_and_multi_dimension_group(sample_dataset) -> None:
    result = AnalyticsService().query(
        snapshot=sample_dataset.snapshot,
        query=AnalyticsQuery(
            questionId="scale-1",
            filters={"city": "北京"},
            groupBy=["gender", "income"],
        ),
    )
    assert result.filteredRespondentCount == 1
    assert result.groupedQuestionSummaries[0].respondentCount == 1
```

- [ ] **Step 2: Run the tests to verify the service is absent**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_analytics_service.py -v
```

Expected: FAIL importing `AnalyticsService`.

- [ ] **Step 3: Implement all migrated analytics**

Implement these methods with the current TypeScript behavior:

- `analyze_sentiment(sessions) -> SentimentData`: count respondent messages by
  sentiment, divide by the nonzero total, and round each percentage.
- `analyze_questions(sessions, questions) -> list[QuestionAnalysis]`: collect
  typed answer values by question, produce string-key distributions, and
  calculate arithmetic means only for scale answers.
- `analyze_demographics(sessions, respondents, questions)`: generate the same
  city and `收入:<income>` records as the current frontend.
- `build_responses(sessions, survey_id, questions)`: map each respondent
  session to a stable response, map pending/in-progress status to `partial`,
  and select answer type from the matching question.
- `query(snapshot, query)`: construct dimension metadata, filter respondents,
  filter sessions by respondent ID, analyze the selected question, group the
  filtered respondents by the ordered `groupBy` dimensions, and return one
  `GroupedQuestionSummary` per nonempty group.

Port `getDimensionMetadata`, `filterRespondentsByDimensions`, and `groupRespondentsByDimensions` into private backend helpers. Preserve dimension labels:

```python
DIMENSION_LABELS = {
    "gender": "性别",
    "ageRange": "年龄段",
    "occupation": "职业",
    "city": "工作城市",
    "income": "收入区间",
}
```

Use the source question type when building answers instead of inferring it from Python value type.

- [ ] **Step 4: Run analytics tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_analytics_service.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit analytics**

```bash
git add backend/app/services/analytics_service.py backend/tests/test_analytics_service.py
git commit -m "feat: move survey analytics to backend"
```

## Task 5: In-memory repository and asynchronous run service

**Files:**

- Create: `backend/app/repositories/__init__.py`
- Create: `backend/app/repositories/memory.py`
- Create: `backend/app/services/run_service.py`
- Create: `backend/tests/test_run_service.py`

- [ ] **Step 1: Write failing lifecycle tests**

```python
@pytest.mark.asyncio
async def test_run_progresses_to_completed(default_config) -> None:
    repository = MemoryRepository()
    service = RunService(
        repository=repository,
        engine=MockEngine(random.Random(1), delay_scale=0),
        analytics=AnalyticsService(),
    )

    created = await service.create_run(
        CreateRunRequest(mode="survey", config=default_config)
    )
    completed = await service.wait(created.id)

    assert completed.status == "completed"
    assert completed.progress.totalRespondents == 7
    assert (
        completed.progress.completedRespondents
        + completed.progress.terminatedRespondents
        == 7
    )
    assert completed.activeRespondentId is None


@pytest.mark.asyncio
async def test_cancel_stops_run(long_running_service, default_config) -> None:
    created = await long_running_service.create_run(
        CreateRunRequest(mode="interview", config=default_config)
    )
    cancelled = await long_running_service.cancel(created.id)
    assert cancelled.status == "cancelled"
```

- [ ] **Step 2: Run tests and observe missing repository/service**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_run_service.py -v
```

Expected: FAIL importing `MemoryRepository` or `RunService`.

- [ ] **Step 3: Implement the in-memory repository**

```python
class MemoryRepository:
    def __init__(self) -> None:
        self._runs: dict[str, RunSnapshot] = {}
        self._history: list[SurveyHistoryRecord] = []
        self._lock = asyncio.Lock()

    async def put_run(self, snapshot: RunSnapshot) -> None:
        async with self._lock:
            self._runs[snapshot.id] = snapshot.model_copy(deep=True)

    async def get_run(self, run_id: str) -> RunSnapshot | None:
        async with self._lock:
            value = self._runs.get(run_id)
            return value.model_copy(deep=True) if value else None

    async def save_history(self, run: RunSnapshot) -> SurveyHistoryRecord:
        record = SurveyHistoryRecord(
            id=f"history-{uuid4()}",
            savedAt=datetime.now(UTC),
            config=run.config,
            sessions=run.sessions,
            respondents=run.respondents,
            progress=run.progress,
            sentiment=run.sentiment,
            questionAnalysis=run.questionAnalysis,
            demographicAnalysis=run.demographicAnalysis,
            responses=run.responses,
        )
        async with self._lock:
            self._history.insert(0, record.model_copy(deep=True))
        return record

    async def list_history(self) -> list[SurveyHistoryRecord]:
        async with self._lock:
            return [item.model_copy(deep=True) for item in self._history]

    async def get_history(
        self, history_id: str
    ) -> SurveyHistoryRecord | None:
        async with self._lock:
            value = next(
                (item for item in self._history if item.id == history_id),
                None,
            )
            return value.model_copy(deep=True) if value else None
```

History records are inserted newest first and copied deeply.

- [ ] **Step 4: Implement run orchestration**

`RunService.create_run` creates a queued snapshot and starts an `asyncio.Task`. `_execute`:

1. Changes status to `running`.
2. Generates respondents.
3. Initializes pending sessions.
4. For each respondent:
   - marks the session in progress;
   - adds each interviewer question;
   - awaits the configured question/answer delays;
   - generates or terminates the response;
   - updates the session;
   - calls one `_refresh_analytics(snapshot)` helper;
   - evaluates interviewer termination.
5. Finalizes the session and progress.
6. Sets the run to `completed`.
7. On cancellation, sets `cancelled`.
8. On exception, sets `failed` and records `error`.

Public method behavior:

- `create_run(request)` constructs the complete empty queued snapshot, stores
  it, registers `asyncio.create_task(self._execute(run_id))` in
  `self._tasks`, and returns the stored snapshot.
- `get(run_id)` delegates to the repository.
- `cancel(run_id)` returns `None` when absent; returns the existing snapshot
  when terminal; otherwise cancels and awaits its task, stores status
  `cancelled`, clears `activeRespondentId`, and returns the updated snapshot.
- `wait(run_id)` awaits the registered task when present, reloads the snapshot,
  and raises `KeyError(run_id)` only when the repository has no matching run.

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_run_service.py -v
```

Expected: all lifecycle and cancellation tests pass without real sleeps in deterministic mode.

- [ ] **Step 6: Commit repository and run service**

```bash
git add backend/app/repositories backend/app/services/run_service.py backend/tests/test_run_service.py
git commit -m "feat: add in-memory survey run orchestration"
```

## Task 6: Template and run HTTP APIs

**Files:**

- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/dependencies.py`
- Create: `backend/app/api/templates.py`
- Create: `backend/app/api/runs.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_api.py`

- [ ] **Step 1: Add failing API tests**

```python
def test_default_template(client) -> None:
    response = client.get("/api/templates/default")
    assert response.status_code == 200
    assert response.json()["title"] == "用户体验调研"


def test_create_and_read_run(client, default_config_json) -> None:
    created = client.post(
        "/api/runs",
        json={"mode": "survey", "config": default_config_json},
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    fetched = client.get(f"/api/runs/{run_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == run_id


def test_missing_run_has_structured_error(client) -> None:
    response = client.get("/api/runs/missing")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "RUN_NOT_FOUND"
```

- [ ] **Step 2: Run API tests and verify 404/import failures**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_api.py -v
```

Expected: template/run tests fail before routers are registered.

- [ ] **Step 3: Add dependency providers and routers**

`dependencies.py` owns singleton instances:

```python
repository = MemoryRepository()
analytics_service = AnalyticsService()
run_service = RunService(
    repository=repository,
    engine=MockEngine(),
    analytics=analytics_service,
)
export_service = ExportService()
```

`templates.py`:

```python
router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("/default", response_model=SurveyConfig)
async def get_default_template() -> SurveyConfig:
    return default_survey_config()
```

`runs.py`:

```python
router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=RunSnapshot, status_code=201)
async def create_run(request: CreateRunRequest) -> RunSnapshot:
    return await run_service.create_run(request)


@router.get("/{run_id}", response_model=RunSnapshot)
async def get_run(run_id: str) -> RunSnapshot:
    run = await run_service.get(run_id)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "RUN_NOT_FOUND", "message": "运行记录不存在"},
        )
    return run


@router.post("/{run_id}/cancel", response_model=RunSnapshot)
async def cancel_run(run_id: str) -> RunSnapshot:
    run = await run_service.cancel(run_id)
    if run is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "RUN_NOT_FOUND", "message": "运行记录不存在"},
        )
    return run
```

Register routers in `main.py`.

- [ ] **Step 4: Isolate test dependencies**

In `conftest.py`, replace dependency singletons or application state with a fresh repository, seeded `MockEngine`, and zero-delay `RunService` for each test. Expose `client`, `default_config`, and `default_config_json` fixtures.

- [ ] **Step 5: Run API tests**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_api.py -v
```

Expected: template, create, read, cancel, 404, and 422 tests pass.

- [ ] **Step 6: Commit run APIs**

```bash
git add backend/app/api backend/app/main.py backend/tests
git commit -m "feat: expose survey templates and run APIs"
```

## Task 7: History, analytics query, and exports APIs

**Files:**

- Create: `backend/app/services/export_service.py`
- Create: `backend/app/api/history.py`
- Create: `backend/app/api/analytics.py`
- Create: `backend/app/api/exports.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Create: `backend/tests/test_export_service.py`

- [ ] **Step 1: Add failing history and export tests**

```python
def test_save_list_and_read_history(client, completed_run_id) -> None:
    saved = client.post("/api/history", json={"runId": completed_run_id})
    assert saved.status_code == 201
    history_id = saved.json()["id"]

    records = client.get("/api/history")
    assert records.status_code == 200
    assert records.json()[0]["id"] == history_id

    detail = client.get(f"/api/history/{history_id}")
    assert detail.status_code == 200
    assert detail.json()["config"]["title"] == "用户体验调研"


def test_run_analytics_query_is_server_computed(client, completed_run_id) -> None:
    response = client.post(
        f"/api/runs/{completed_run_id}/analytics/query",
        json={"questionId": "q1", "filters": {}, "groupBy": ["city"]},
    )
    assert response.status_code == 200
    assert response.json()["groupedQuestionSummaries"]


def test_csv_export_is_downloadable(client, completed_run_id) -> None:
    response = client.get(
        f"/api/runs/{completed_run_id}/exports",
        params={"format": "csv"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.text.startswith("respondentId,name,city,status")
```

- [ ] **Step 2: Run tests and verify endpoint failures**

Run:

```bash
backend/.venv/bin/python -m pytest \
  backend/tests/test_api.py \
  backend/tests/test_export_service.py -v
```

Expected: FAIL because services/routers are absent.

- [ ] **Step 3: Implement safe JSON and CSV export**

```python
class ExportService:
    def json_bytes(self, snapshot: RunSnapshot | SurveyHistoryRecord) -> bytes:
        payload = {
            "exportedAt": datetime.now(UTC).isoformat(),
            "totalRespondents": len(snapshot.respondents),
            "completedInterviews": sum(
                session.status == "completed" for session in snapshot.sessions
            ),
            "sessions": [
                {
                    "respondentId": session.respondentId,
                    "status": session.status,
                    "terminationReason": session.terminationReason,
                    "completedQuestions": session.completedQuestions,
                    "dialog": [
                        item.model_dump(mode="json") for item in session.dialog
                    ],
                }
                for session in snapshot.sessions
            ],
            "respondents": [
                item.model_dump(mode="json") for item in snapshot.respondents
            ],
        }
        return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")

    def csv_bytes(self, snapshot: RunSnapshot | SurveyHistoryRecord) -> bytes:
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
```

Use `csv.writer`, never manual comma concatenation.

- [ ] **Step 4: Implement history, analytics, and export routers**

History save accepts only `CreateHistoryRequest(runId="<run-id>")`, loads the run, and calls `repository.save_history(run)`.

Analytics routers load a current run or convert a history record into a compatible snapshot input before calling `AnalyticsService.query`.

Export routers validate `format` as `Literal["json", "csv"]` and return:

```python
Response(
    content=content,
    media_type=media_type,
    headers={
        "Content-Disposition": f'attachment; filename="survey-results.{format}"'
    },
)
```

Register all three routers in `main.py`.

- [ ] **Step 5: Run the complete backend suite**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests -v
```

Expected: all backend tests pass.

- [ ] **Step 6: Commit backend feature completeness**

```bash
git add backend/app backend/tests
git commit -m "feat: add backend history analytics and exports"
```

## Task 8: Next.js rewrite and real HTTP client

**Files:**

- Modify: `next.config.mjs`
- Modify: `lib/survey-api.ts`
- Create: `tests/survey-api.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing frontend API contract tests**

Create a Node test that reads source files and asserts:

```js
test("survey API uses the same-origin backend path", () => {
  const source = readFileSync("lib/survey-api.ts", "utf8")
  assert.match(source, /const API_BASE = "\\/survey-api"/)
})

test("Next rewrites survey API requests", () => {
  const source = readFileSync("next.config.mjs", "utf8")
  assert.match(source, /source: "\\/survey-api\\/:path\\*"/)
  assert.match(source, /SURVEY_BACKEND_URL/)
})
```

Add `"test:frontend": "node --test tests/*.test.mjs"` to `package.json`.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:frontend
```

Expected: FAIL because the HTTP API base and rewrite do not exist.

- [ ] **Step 3: Implement the rewrite**

```js
const surveyBackendUrl =
  process.env.SURVEY_BACKEND_URL ?? "http://127.0.0.1:8000"

const nextConfig = {
  // preserve existing TypeScript and image settings
  async rewrites() {
    return [
      {
        source: "/survey-api/:path*",
        destination: `${surveyBackendUrl}/api/:path*`,
      },
    ]
  },
}
```

- [ ] **Step 4: Add the HTTP client alongside the temporary compatibility exports**

Keep the existing Mock exports temporarily so untouched consumers continue to
compile. Add the shared contract exports and HTTP request helper:

```ts
export type {
  AnalyticsQuery,
  AnalyticsQueryResult,
  RunSnapshot,
  RunStatus,
  SimulationMode,
} from "./survey-contract"

import type {
  AnalyticsQuery,
  AnalyticsQueryResult,
  RunSnapshot,
  SimulationMode,
  SurveyConfig,
  SurveyHistoryRecord,
} from "./survey-contract"

const API_BASE = "/survey-api"

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Survey API ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<T>
}
```

Export these exact functions:

```ts
apiFetchDefaultTemplate(signal?: AbortSignal): Promise<SurveyConfig>
apiCreateRun(mode: SimulationMode, config: SurveyConfig): Promise<RunSnapshot>
apiFetchRun(runId: string, signal?: AbortSignal): Promise<RunSnapshot>
apiCancelRun(runId: string): Promise<RunSnapshot>
apiSaveRunToHistory(runId: string): Promise<SurveyHistoryRecord>
apiFetchSurveyHistory(): Promise<SurveyHistoryRecord[]>
apiFetchSurveyHistoryById(id: string): Promise<SurveyHistoryRecord>
apiQueryRunAnalytics(runId: string, query: AnalyticsQuery): Promise<AnalyticsQueryResult>
apiQueryHistoryAnalytics(historyId: string, query: AnalyticsQuery): Promise<AnalyticsQueryResult>
apiExportBackendResults(source: { type: "run" | "history"; id: string }, format: "json" | "csv"): Promise<Blob>
```

Name the new export function `apiExportBackendResults` during the compatibility
window because the existing API already exports `apiExportSurveyResults` with a
different signature. It uses `fetch` directly and returns `response.blob()`.
Task 10 removes the compatibility exports and renames it to
`apiExportSurveyResults`.

- [ ] **Step 5: Run frontend API tests and typecheck**

Run:

```bash
npm run test:frontend
npm run typecheck
```

Expected: source contract tests and the full TypeScript check pass because the
temporary compatibility exports remain available.

- [ ] **Step 6: Commit transport layer**

```bash
git add next.config.mjs lib/survey-api.ts tests/survey-api.test.mjs package.json
git commit -m "feat: connect frontend to FastAPI survey service"
```

## Task 9: Replace client orchestration with run polling

**Files:**

- Modify: `app/page.tsx`
- Modify: `tests/survey-api.test.mjs`

- [ ] **Step 1: Add failing source-boundary tests**

```js
test("dashboard contains no client-side survey orchestration", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  for (const forbidden of [
    "askQuestion",
    "shouldInterviewerTerminate",
    "analyzeSentiment",
    "analyzeQuestionResponses",
    "analyzeByDemographics",
    "apiBuildSurveyResponses",
    "apiGenerateRespondentsFromConfig",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden))
  }
  assert.match(source, /apiCreateRun/)
  assert.match(source, /apiFetchRun/)
})
```

- [ ] **Step 2: Run the boundary test and verify it fails**

Run:

```bash
npm run test:frontend
```

Expected: FAIL with forbidden orchestration names.

- [ ] **Step 3: Replace state with a backend snapshot**

Use:

```ts
const EMPTY_PROGRESS: SurveyProgress = {
  totalRespondents: 0,
  completedRespondents: 0,
  inProgressRespondents: 0,
  terminatedRespondents: 0,
  currentRespondentIndex: 0,
}
const EMPTY_SENTIMENT: SentimentData = {
  positive: 0,
  neutral: 0,
  negative: 0,
}

const [config, setConfig] = useState<SurveyConfig | null>(null)
const [currentRun, setCurrentRun] = useState<RunSnapshot | null>(null)
const [viewingHistoryRecord, setViewingHistoryRecord] =
  useState<SurveyHistoryRecord | null>(null)
```

Load the default template in `useEffect` with an `AbortController`. Until it arrives, render the existing shell with a centered spinner rather than a partially initialized config panel.

- [ ] **Step 4: Implement create-and-poll behavior**

`runSimulation`:

```ts
const runSimulation = useCallback(async () => {
  if (!config || isRunning) return
  setActiveWorkspace("results")
  setConfigSheetOpen(false)
  setViewingHistoryRecord(null)
  setIsRunning(true)
  try {
    const created = await apiCreateRun(mode, config)
    setCurrentRun(created)
  } catch (error) {
    console.error("Simulation error:", error)
    setIsRunning(false)
  }
}, [config, isRunning, mode])
```

Polling effect:

```ts
useEffect(() => {
  if (!currentRun || !["queued", "running"].includes(currentRun.status)) {
    return
  }
  let cancelled = false
  const timer = window.setInterval(async () => {
    try {
      const next = await apiFetchRun(currentRun.id)
      if (cancelled) return
      setCurrentRun(next)
      if (!["queued", "running"].includes(next.status)) {
        setIsRunning(false)
        window.clearInterval(timer)
      }
    } catch (error) {
      console.error("Polling error:", error)
      setIsRunning(false)
      window.clearInterval(timer)
    }
  }, 250)
  return () => {
    cancelled = true
    window.clearInterval(timer)
  }
}, [currentRun?.id, currentRun?.status])
```

Derive all displayed values directly from `viewingHistoryRecord ?? currentRun`, with empty constants only when neither exists.

- [ ] **Step 5: Change export source selection**

```ts
const exportSource = viewingHistoryRecord
  ? { type: "history" as const, id: viewingHistoryRecord.id }
  : currentRun
    ? { type: "run" as const, id: currentRun.id }
    : null
```

Call `apiExportBackendResults(exportSource, format)` and preserve the existing
browser download behavior.

- [ ] **Step 6: Run boundary tests and typecheck**

Run:

```bash
npm run test:frontend
npm run typecheck
```

Expected: dashboard boundary test and the full TypeScript check pass; the
temporary compatibility exports still support `AnalyticsPanel`.

- [ ] **Step 7: Commit page migration**

```bash
git add app/page.tsx tests/survey-api.test.mjs
git commit -m "refactor: render backend-owned survey runs"
```

## Task 10: Move history and analytics panel logic to APIs

**Files:**

- Modify: `components/analytics-panel.tsx`
- Modify: `components/chat-simulation-panel.tsx`
- Modify: `app/page.tsx`
- Modify: `tests/survey-api.test.mjs`
- Delete: `lib/mock-survey-service.ts`

- [ ] **Step 1: Add failing production-boundary tests**

```js
test("production frontend has no mock survey imports", () => {
  for (const file of [
    "app/page.tsx",
    "components/analytics-panel.tsx",
    "components/chat-simulation-panel.tsx",
    "components/bulk-survey-panel.tsx",
    "components/survey-config-panel.tsx",
    "lib/survey-api.ts",
  ]) {
    const source = readFileSync(file, "utf8")
    assert.doesNotMatch(source, /mock-survey-service/)
  }
})

test("analytics panel delegates business calculations", () => {
  const source = readFileSync("components/analytics-panel.tsx", "utf8")
  for (const forbidden of [
    "analyzeQuestionResponses",
    "filterRespondentsByDimensions",
    "getDimensionMetadata",
    "groupRespondentsByDimensions",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden))
  }
  assert.match(source, /apiQueryRunAnalytics/)
})
```

- [ ] **Step 2: Run tests and verify old analytics imports fail**

Run:

```bash
npm run test:frontend
```

Expected: FAIL on old imports and client calculations.

- [ ] **Step 3: Change AnalyticsPanel ownership inputs**

Add props:

```ts
source:
  | { type: "run"; id: string }
  | { type: "history"; id: string }
  | null
```

Change saving:

```ts
await apiSaveRunToHistory(source.id)
```

Only enable saving for a completed current run. Keep history list loading with `apiFetchSurveyHistory`.

- [ ] **Step 4: Replace client analytics with query results**

Maintain UI selections:

```ts
const [analyticsResult, setAnalyticsResult] =
  useState<AnalyticsQueryResult | null>(null)
```

Whenever `source`, `selectedQuestion`, `dimensionFilters`, or `groupByDimensions` changes, debounce by 100 ms and call:

```ts
const query = {
  questionId: selectedQuestion,
  filters: dimensionFilters,
  groupBy: groupByDimensions,
}
const result =
  source.type === "run"
    ? await apiQueryRunAnalytics(source.id, query)
    : await apiQueryHistoryAnalytics(source.id, query)
setAnalyticsResult(result)
```

Render:

- filter selectors from `analyticsResult.dimensionMetadata`;
- filtered response chart from `analyticsResult.filteredQuestionAnalysis`;
- grouped cards from `analyticsResult.groupedQuestionSummaries`.

Continue rendering global overview and demographic tabs from the snapshot fields returned by the backend.

- [ ] **Step 5: Remove the final Mock dependency**

Change `ChatSimulationPanel` imports to:

```ts
import type {
  InterviewSession,
  RespondentProfile,
} from "@/lib/survey-contract"
```

Rewrite `lib/survey-api.ts` so it starts with
`export * from "./survey-contract"`, retains only the HTTP request helper and
backend API functions, removes every import from `mock-survey-service`, and
renames `apiExportBackendResults` to `apiExportSurveyResults`. Update
`app/page.tsx` to import the final export name.

Delete `lib/mock-survey-service.ts` after `rg` confirms no production import remains:

```bash
rg -n "mock-survey-service|askQuestion|analyzeQuestionResponses" \
  app components lib
```

Expected before deletion: no matches except the file being deleted.

- [ ] **Step 6: Run frontend tests, typecheck, and build**

Run:

```bash
npm run test:frontend
npm run typecheck
npm run build
```

Expected: all frontend tests pass; TypeScript has no errors; Next.js production build exits 0.

- [ ] **Step 7: Commit frontend business-logic removal**

```bash
git add app/page.tsx components lib tests
git commit -m "refactor: move frontend survey logic behind backend APIs"
```

## Task 11: Full-stack scripts, documentation, and end-to-end verification

**Files:**

- Create: `backend/scripts/dev-full.sh`
- Create: `backend/README.md`
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`
- Modify: `docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md`

- [ ] **Step 1: Add the full-stack process script**

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_dir"

cleanup() {
  kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
  wait "$backend_pid" "$frontend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev:backend &
backend_pid=$!
npm run dev &
frontend_pid=$!

wait -n "$backend_pid" "$frontend_pid"
```

Initialize PID variables before installing the trap so `set -u` cannot fail during early startup.

- [ ] **Step 2: Document exact setup and operation**

`backend/README.md` must include:

```bash
bash backend/scripts/bootstrap.sh
npm run dev:backend
backend/.venv/bin/python -m pytest backend/tests -v
```

Root `README.md` must describe:

```bash
bash backend/scripts/bootstrap.sh
npm run dev:full
```

State explicitly that first-version history is retained across frontend refreshes but lost when FastAPI restarts.

- [ ] **Step 3: Update migration tracking**

In `docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md`, mark only first-version completed items:

- FastAPI and contract separation.
- Mock respondent generation.
- backend-owned runs and progress.
- backend history in memory.
- backend analytics/filter/group.
- backend export.
- production frontend Mock removal.

Leave database, real models, durable queue, authentication, and persistent history unchecked.

Add a dated entry to `docs/PROJECT_ITERATION.md` with goal, completed scope, verification commands, known limitations, and next step.

- [ ] **Step 4: Run fresh automated verification**

Run:

```bash
backend/.venv/bin/python --version
backend/.venv/bin/python -m pytest backend/tests -v
npm run test:frontend
npm run typecheck
npm run build
rg -n "mock-survey-service|askQuestion|shouldInterviewerTerminate|analyzeSentiment|analyzeQuestionResponses|analyzeByDemographics" app components lib
```

Expected:

- Python 3.14.6.
- All backend tests pass.
- All frontend tests pass.
- TypeScript passes.
- Production build passes.
- `rg` returns no production matches.

- [ ] **Step 5: Start both services and verify health**

Start `npm run dev:full`, then verify:

```bash
curl --fail http://127.0.0.1:8000/api/health
curl --fail http://127.0.0.1:3000/survey-api/health
```

Expected: both return the same healthy FastAPI payload.

- [ ] **Step 6: Execute browser end-to-end verification**

Use the browser automation skill against `http://127.0.0.1:3000`:

1. Confirm the default title and five questions load.
2. Run survey mode and wait for completion.
3. Confirm seven respondents are represented and question statistics appear.
4. Save history and open the saved record.
5. Apply a city filter and a city + income group.
6. Trigger JSON and CSV downloads.
7. Switch to interview mode, run, select a respondent, and inspect messages.
8. Confirm no browser console errors.
9. Capture desktop screenshots and compare layout and visible labels to the pre-migration baseline.

- [ ] **Step 7: Commit scripts and documentation**

```bash
git add backend README.md docs package.json
git commit -m "docs: document FastAPI survey backend workflow"
```

- [ ] **Step 8: Final diff and status review**

Run:

```bash
git diff --check HEAD~1
git status --short
git log --oneline -12
```

Expected: no whitespace errors; only pre-existing unrelated user files remain untracked; implementation commits are visible in order.
