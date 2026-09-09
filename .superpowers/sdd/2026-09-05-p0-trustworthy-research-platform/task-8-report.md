# Task 8 report: durable round workflows and trustworthy result UI

## Status

Implemented Task 8's owner-scoped durable round workflow in the frontend. The
dashboard no longer maintains a second in-memory run/history write model:
controls, polling, history, copy, analysis, exception drill-down, and exports
all use the Task 4–6 round APIs and server-returned snapshots.

The deferred Task 7 conflict-reload issue was also resolved while touching the
page: a failed confirmed reload now remains visibly conflicted/error state and
is handled without an unhandled promise rejection.

## Files

Created:

- `components/analysis-scope-summary.tsx`
- `components/exception-drilldown.tsx`
- `components/export-dialog.tsx`
- `components/round-history-dialog.tsx`
- `components/run-control-bar.tsx`
- `lib/run-actions.ts`
- `tests/analysis-scope-ui.test.mjs`
- `tests/export-dialog.test.mjs`
- `tests/run-actions.test.mjs`

Modified:

- `app/layout.tsx`
- `app/page.tsx`
- `components/analytics-panel.tsx`
- `components/bulk-survey-panel.tsx`
- `components/chat-simulation-panel.tsx`
- `components/survey-config-panel.tsx`
- `lib/i18n/messages.ts`
- `lib/survey-api.ts`
- `lib/survey-contract.ts`
- `tests/i18n.test.mjs`
- `tests/research-resources.test.mjs`
- `tests/survey-api.test.mjs`

## Implementation

- Added the exact round action matrix for `queued`, `running`, `pausing`,
  `paused`, `completed_with_errors`, and `cancelled`. A single-flight mutation
  guard prevents duplicate requests; the mutation response immediately
  replaces the displayed snapshot.
- Restricted polling to `queued`, `running`, and `pausing`. Poll responses are
  identity- and `rowVersion`-guarded so an older response cannot overwrite a
  newer mutation or poll snapshot.
- Replaced the legacy browser history UI and compatibility API calls with the
  selected project's durable round list. History shows questionnaire, mode,
  config/questionnaire version identifiers, status, sample summary, and
  timestamps; selected history config is immutable and copy uses the server
  `/rounds/{id}/copy` response.
- Added analysis scope presentation for population, filtered respondents,
  valid responses, and exclusions, plus readable filters and the exploratory
  warning below 30 valid responses.
- Corrected mode-specific analytics wording and counts: survey results use
  questionnaire/answer/completion semantics, while interview results use
  dialog/interview semantics.
- Added exception group drill-down with respondent progress/evidence and
  respondent focus in both survey and interview result panels.
- Added JSON/CSV export for `full`, `filtered`, and `exceptions` scopes.
  Filtered export is unavailable without filters. Downloads use the server's
  `Content-Disposition` filename, including RFC 5987 `filename*`, and round
  history lists durable export records.
- Added bilingual progress, success, stable API-code failure, scope, history,
  exception, and export messages. A layout-level toast host presents export
  completion with scope, time, and filename.
- Removed the legacy history contract and client wrappers rather than keeping
  two write models.
- Wrapped the Task 7 confirmed conflict reload in its own error boundary. If
  reload fails, the draft remains `conflicted`, the resource error remains
  visible, and the save queue does not leak a rejected promise.

## API path audit

The final frontend paths and payloads were checked against the existing
FastAPI routers in `runs.py`, `analytics.py`, `exceptions.py`, and `exports.py`:

- `/projects/{projectId}/rounds`
- `/rounds/{roundId}`
- `/rounds/{roundId}/pause`
- `/rounds/{roundId}/resume`
- `/rounds/{roundId}/cancel`
- `/rounds/{roundId}/retry` with `{kind}`
- `/rounds/{roundId}/copy`
- `/rounds/{roundId}/analytics/query`
- `/rounds/{roundId}/exceptions`
- `/rounds/{roundId}/exports`

The analytics contract uses the backend's `scope`, `validResponseCount`, and
group count fields. Browser mutation payloads contain no owner identity.

## TDD evidence

### Initial RED

The brief's focused command was run before implementation:

```text
npm run test:frontend -- tests/run-actions.test.mjs tests/analysis-scope-ui.test.mjs tests/export-dialog.test.mjs
```

Because the package script also includes the repository frontend glob, the
observed summary was:

```text
tests 106
pass 96
fail 10
```

The failures were the intended missing Task 8 surface: action/poll/duplicate
guard utilities, scope and exception UI, export dialog/API/history, mode-aware
analytics wording, and stable localized round/export errors.

### Focused implementation GREEN

The first implementation run across action, scope, export, and catalog tests
observed `52 passed, 7 failed`. One new assertion targeted the wrong local
group expression, and six Task 7 source assertions still required the removed
legacy compatibility layer. They were corrected to test the durable contract.

The next focused run passed:

```text
tests 59
pass 59
fail 0
```

After adding exact API-path, response-replacement, mode-semantics, and Task 7
conflict-reload coverage, the broader focused run passed:

```text
node --test tests/run-actions.test.mjs tests/analysis-scope-ui.test.mjs tests/export-dialog.test.mjs tests/research-resources.test.mjs tests/survey-api.test.mjs tests/i18n.test.mjs tests/theme-switching.test.mjs

tests 87
pass 87
fail 0
```

An intermediate `npm run typecheck` also exited `0`.

### Self-review RED/GREEN

Self-review found that a slow poll response could overwrite a newer mutation
snapshot. A regression test was added before the fix:

```text
node --test --test-name-pattern='poll responses cannot overwrite' tests/run-actions.test.mjs

fail 1
TypeError: mergePolledRoundSnapshot is not a function
```

After adding the identity/`rowVersion` merge guard and wiring it into polling:

```text
node --test tests/run-actions.test.mjs

tests 4
pass 4
fail 0
```

A final switch-race review then added a second assertion: after a project or
questionnaire switch has cleared the current round, an already-resolved old
poll must not recreate it. The targeted test failed with the stale incoming
round instead of `null`, then the same `4/4` action suite and typecheck passed
after the merge guard was tightened.

## Final verification

The final chain was first run in the normal sandbox:

```text
npm run test:frontend && npm run typecheck && npm run build
```

The frontend suite passed `110/110` and `tsc --noEmit` exited `0`. The build
then failed before compilation with a Turbopack internal error while creating
a helper process and binding a port: `Operation not permitted (os error 1)`.
The panic log confirmed an environment permission failure rather than a source
diagnostic.

The same full chain was rerun unchanged with the required sandbox escalation:

```text
frontend tests: 110 passed, 0 failed
tsc --noEmit: exit 0
next build: exit 0
```

Next.js 16.1.6 compiled successfully, generated all 5 static pages, and listed
the expected routes. The existing non-failing warning about the custom Babel
configuration was retained and is not introduced by Task 8.

Additional final checks:

```text
git diff --check: exit 0
legacy production history identifiers: none
```

## Self-review

- State machine: actions are status-specific; retry buttons also require the
  corresponding failed/incomplete count.
- Async integrity: duplicate mutations cannot start, mutations adopt the
  server snapshot immediately, only active states poll, and stale polls cannot
  replace newer state or recreate a round after a resource switch.
- Ownership: all history, result, exception, copy, and export calls are scoped
  through owned project/round resources; the client sends no owner key.
- Immutability: history configuration is disabled while remaining scrollable;
  copying creates/selects the server-returned draft without editing the source.
- Analysis truthfulness: scope counts come directly from the backend contract,
  small samples are identified, and survey/interview semantics do not leak
  across modes.
- Export integrity: exact scope values and current filters are sent, the server
  filename wins, stable failures are localized, and durable records appear in
  history.
- Task 7 regression: confirmed conflict reload failure stays handled and leaves
  the conflicted/error UI state intact.
- Scope: the initial Task 8 commit changed no backend, database, auth, worker,
  or deployment behavior.

## Concerns / follow-up

No Task 8 blocker.

- The frontend tests combine behavior tests for action/race/API/download logic
  with source-contract tests for component wiring. A live PostgreSQL/worker and
  real-browser end-to-end pass remains Tasks 9–10.
- In this environment Turbopack needs an unsandboxed helper process/port for a
  production build; the approved rerun completed successfully.
- Next.js continues to warn that the repository's custom Babel configuration
  can be removed. The warning is pre-existing and non-failing.

## Commit

Commit message: `feat: complete P0 research workflows`. The resulting commit
identifier is recorded in the task handoff because embedding a commit's own
identifier would change that identifier.

---

## Reviewer fix round 1 (2026-09-08)

### Findings addressed

1. Aligned queued-round controls with the backend's authoritative
   `ACTION_BY_STATUS`: queued rounds now expose both pause and cancel. The
   backend pause service converts a queued round directly to paused.
2. Added a generation-, identity-, and request-kind-aware guard for durable
   round history list, detail, and copy operations. Abort remains an
   optimization; late resolved or rejected promises cannot update history,
   selection, mode, errors, or copied questionnaires after a project or
   questionnaire switch. A newer detail request also invalidates an older one
   for another selected round. Resource switches synchronously clear stale
   history loading/error/copy indicators.
3. Removed the unused backend browser write-model schemas
   `SurveyHistoryRecord` and `CreateHistoryRequest`, their dead conversion
   helper, and the unused `CreateRunRequest`. Repository-wide production usage
   inspection found no consumers; current round creation uses
   `QuestionnaireView` plus `RoundSnapshot` through `RunService`.

### TDD evidence

Frontend action/race RED:

```text
node --test tests/run-actions.test.mjs

tests 7
pass 3
fail 4
```

The action test observed queued returning only `cancel` instead of
`pause,cancel`. The list/detail/copy race tests failed because
`createRoundResourceRequestGuard` did not exist.

The page-wiring test was then added before integration and failed because the
dashboard did not use the guard. A narrower resource-switch cleanup assertion
also failed before loading/copy state was reset in `applyQuestionnaire`.

Backend schema cleanup RED:

```text
backend/.venv/bin/pytest -q backend/tests/test_schemas.py

7 passed, 1 failed
```

The failure showed the three superseded public schema names still existed.

Focused GREEN after the minimal implementations:

```text
node --test tests/run-actions.test.mjs tests/research-resources.test.mjs tests/survey-api.test.mjs
31 passed, 0 failed

backend/.venv/bin/pytest -q backend/tests/test_schemas.py
8 passed, 0 failed

backend/.venv/bin/pytest -q backend/tests
124 passed, 0 failed
```

### Final verification

After all code changes, the required chain was run in the already-approved
environment needed by Turbopack:

```text
npm run test:frontend && npm run typecheck && npm run build

frontend tests: 114 passed, 0 failed
tsc --noEmit: exit 0
next build: exit 0
```

Next.js 16.1.6 compiled successfully and generated all 5 static pages. The
same existing, non-failing custom Babel configuration warning remains.

### Self-review and concerns

- Mutation check: removing queued pause, any generation or identity
  comparison, the per-kind latest-request check, or any of the three page guard
  calls fails focused coverage.
- Both successful and failed network outcomes pass through the same freshness
  decision before UI state can change.
- Copy success is accepted only while its original project/questionnaire
  identity remains current; switching resources clears the pending copy UI.
- No database model, migration, API route, service behavior, or request payload
  changed. Backend edits only remove unreferenced schema/helper surface.
- Real-browser and live PostgreSQL/worker validation remains assigned to Tasks
  9–10. There is no reviewer-fix blocker.

Commit message: `fix: guard durable round history races`.
