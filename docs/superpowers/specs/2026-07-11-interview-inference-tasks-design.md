# Interview Inference Tasks Design

## Context

The product already supports two simulation flows:

- Interview simulation: create an interview run and inspect respondent dialogs.
- Survey simulation: create a survey run and inspect response analysis.

Two additional task examples need first-class support:

- Profile inference from interview content: infer a respondent's value for a given profile field, such as household income or monthly spending categories.
- Attitude inference from interview content: infer a respondent's attitude toward a given research label, such as common prosperity, public services, upward mobility, or comparison with parents.

This project is still a FastAPI mock-backend prototype. The new capability should be designed as an inference service boundary that can later call a real model, while the first implementation remains deterministic mock behavior.

## Goals

- Support profile inference and attitude inference as optional interview-only tasks.
- Keep existing interview and survey simulations unchanged when inference tasks are disabled.
- Let users enable, add, edit, delete, and select inference tasks from the existing interview configuration panel.
- Store custom inference tasks in the current run configuration snapshot only.
- Show inference summaries in analytics and respondent-level details in the interview result view.
- Preserve inference results in history and JSON/CSV exports.
- Keep failures isolated to individual inference tasks whenever possible.

## Non-Goals

- No global preset-management module in this iteration.
- No durable database persistence beyond the existing in-memory repository and history behavior.
- No real LLM integration in this iteration.
- No standalone import-and-infer workflow for arbitrary pasted interview text in this iteration.
- No inference support for survey mode in this iteration.

## Product And UI Design

The existing interview/survey mode selector remains unchanged. When the user selects interview mode, `SurveyConfigPanel` shows a new collapsed "Inference tasks" section. The section is off by default.

Inside the section:

- A profile inference switch controls whether profile tasks run.
- An attitude inference switch controls whether attitude tasks run.
- Enabling either switch reveals the corresponding task list.
- Each task has an enabled checkbox so the user can select which tasks run.
- Users can add, edit, and delete tasks.
- Custom task edits are saved only inside the current survey configuration.

Profile inference tasks contain:

- `id`
- `name`
- `options`
- `multiple`
- `enabled`

Attitude inference tasks contain:

- `id`
- `name`
- `options`
- `enabled`

The default attitude options are `积极`, `中立`, and `消极`.

The initial preset lists are based on `task_examples`:

- Profile fields: `家庭年收入`, `家庭成员关系`, `家庭月消费主要支出项目`.
- Attitude labels: `共同富裕倾向`, `公共服务评价`, `向上流动倾向`, `和父辈相比`.

## Result Presentation

The result experience uses a two-level layout:

- `AnalyticsPanel` adds an inference tab/page for aggregate results.
- `ChatSimulationPanel` adds respondent-level inference details.

The analytics inference page shows:

- Profile field distributions.
- Attitude label distributions.
- Completed, skipped, and failed counts.
- A compact result table by respondent and task.

The interview detail area shows:

- Inference chips for the selected respondent.
- Predicted values and attitude labels.
- Reason text.
- Evidence references from the dialog, such as question id, message id, or a short excerpt.

JSON and CSV exports include inference results. CSV uses stable column names such as:

- `inference.profile.家庭年收入`
- `inference.profile.家庭成员关系`
- `inference.attitude.共同富裕倾向`
- `inference.attitude.共同富裕倾向.reason`

## Data Model

Add an optional `inferenceConfig` field to `SurveyConfig`.

```python
InferenceKind = Literal["profile", "attitude"]
InferenceTaskStatus = Literal["completed", "skipped", "failed"]

class ProfileInferenceTask(ApiModel):
    id: str
    name: str
    options: list[str]
    multiple: bool = False
    enabled: bool = True

class AttitudeInferenceTask(ApiModel):
    id: str
    name: str
    options: list[str] = ["积极", "中立", "消极"]
    enabled: bool = True

class InferenceConfig(ApiModel):
    enabled: bool = False
    profileEnabled: bool = False
    attitudeEnabled: bool = False
    profileTasks: list[ProfileInferenceTask] = []
    attitudeTasks: list[AttitudeInferenceTask] = []
```

Add inference result structures to the shared backend and frontend contracts.

```python
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
    value: str | list[str] | None
    reason: str | None = None
    evidence: list[InferenceEvidence] = []
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

`RunSnapshot` and `SurveyHistoryRecord` receive:

- `inferenceResults: list[InferenceResult]`
- `inferenceSummary: list[InferenceSummaryItem]`

The default empty run uses empty lists, so existing clients remain safe when inference is disabled.

## Backend Execution Flow

Add a new `InferenceService` with a model-ready interface:

```python
class InferenceService:
    async def infer_for_session(
        self,
        *,
        run_id: str,
        respondent: RespondentProfile,
        session: InterviewSession,
        config: InferenceConfig,
        locale: Locale,
    ) -> list[InferenceResult]:
        ...
```

The first implementation is mock-backed:

- It builds a transcript from the completed interview session.
- It uses task definitions, respondent profile data, answer sentiment, and transcript keywords to choose stable values.
- It returns reason and evidence fields shaped like a future model response.
- It avoids network calls.

`RunService` calls `InferenceService` after each interview respondent finishes. It does not run inference for survey mode and does not run inference when `inferenceConfig.enabled` is false.

The analytics refresh step computes inference summary after results are appended. This can live in either `AnalyticsService` or a small `InferenceAnalysisService`; the implementation should follow existing service boundaries and keep `RunService` focused on orchestration.

## Error Handling

Inference is best-effort per respondent and per task.

- If one task fails, that task gets `status="failed"` and an error message.
- Other tasks for the same respondent continue.
- The interview run remains completed if the interview flow itself succeeds.
- The analytics page shows failed counts so the user can inspect incomplete inference output.
- If inference is enabled but no task is selected, the run records no inference results and should not fail.

## Frontend Contract And State

Update `lib/survey-contract.ts` to mirror backend types.

Update `SurveyConfigPanel`:

- Show inference configuration only in interview mode.
- Default inference switches to off.
- Provide controls for enabling task groups and individual tasks.
- Provide add/edit/delete controls for tasks.
- Validate that task names are non-empty and options are non-empty.

Update `app/page.tsx` state flow only as needed to pass `mode` into the config panel and preserve `inferenceConfig` in config JSON editing.

Update `ChatSimulationPanel`:

- Read `snapshot.inferenceResults`.
- Show selected respondent inference chips.
- Provide a compact detail view for reason and evidence.

Update `AnalyticsPanel`:

- Add an inference page/tab.
- Display summary distributions and failed/skipped counts.
- Include a respondent/task result table.

## Export And History

History records copy `inferenceResults` and `inferenceSummary` along with the rest of the snapshot. Reopening history should show the same inference state and results.

JSON export includes the full inference structures.

CSV export adds stable columns for inference values, reasons, and statuses. Each task gets a status column such as `inference.attitude.共同富裕倾向.status`. Completed tasks fill value and reason columns. Failed and skipped tasks leave value and reason empty, then put `failed` or `skipped` in the status column.

## Testing

Backend tests:

- Schema accepts missing `inferenceConfig` for backward compatibility.
- Schema rejects profile tasks with empty options.
- Default disabled inference produces no inference results.
- Enabled interview inference produces expected result counts.
- Survey mode does not run inference even if inference config is present.
- One failed mock inference task does not fail the whole run.
- History preserves inference results and summary.
- JSON and CSV exports include inference fields.

Frontend tests:

- Contract types cover inference config/results.
- Config panel shows inference tasks only for interview mode.
- Enabling/disabling task groups updates the request payload.
- Add/edit/delete task interactions preserve valid config.
- Analytics inference summary handles completed, skipped, and failed results.
- Chat panel respondent details show chips and reasons for selected respondents.

## Documentation

Update `README.md` and `docs/PROJECT_ITERATION.md` in the implementation change. Both documents must state that this iteration uses mock inference and that outputs are for product simulation, not real research conclusions.

## Open Implementation Notes

- The implementation should keep inference presets in code-local defaults, not in persistent storage.
- The implementation should avoid large UI refactors and fit into the current three-panel workspace.
- The implementation should keep generated mock reasons short enough for cards, tables, and CSV cells.
