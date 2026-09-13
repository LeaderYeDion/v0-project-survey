# Final backend remediation — 2026-09-12

Branch: `real-backend-v1`. Work stayed in the shared checkout; no worktrees, subagents, frontend changes, deployment changes, or restore documentation changes.

## Changes and commits

- `f96e135` — `fix: align backend authentication and schema contracts`
  - `/api/templates/default` now requires the current application user before resolving the template language.
  - Token, cookie, and same-origin CSRF rejection paths use the approved `CSRF_INVALID` code.
  - Removed the redundant explicit indexes `ix_round_respondents_round_ordinal`, `ix_sessions_round_respondent`, and `ix_messages_session_ordinal` from ORM metadata and the initial migration. The existing unique constraints still provide the relevant lookup indexes.
- `aefaf1d` — `fix: translate storage failures at transaction and API boundaries`
  - All SQL-backed auth, research, round, and export repository sessions use a shared storage boundary. SQLAlchemy, asyncpg, and connection/OS failures roll back/close the unit of work and become `503 STORAGE_UNAVAILABLE`.
  - The API boundary also handles raw storage exceptions. Responses contain a safe message and request ID; logs contain the stable code, generated request ID, canonical resource UUIDs where available, and error type, without SQL, parameters, tokens, or sensitive answers.
- `97d641f` — `fix: complete export contents and recover interrupted records`
  - JSON includes export schema version, round metadata, project/questionnaire/version references, configuration version metadata and full configuration, normalized responses, full session status/termination/error fields, exception report, inference results, and inference summaries recalculated for the selected respondents.
  - `scope`, requested `filters`, `appliedFilters`, original `populationCount`, and selected `totalRespondents` make the exported selection explicit.
  - CSV adds `answer.<question-id>` columns in frozen questionnaire order, including columns with no submitted answer, plus termination and error codes/messages.
  - Success finalization is inside the guarded generation path. CAS misses and storage failures attempt a separate failed-state transaction and never return false success. Stored failure messages are sanitized.
  - Stale processing records become failed with `EXPORT_GENERATION_INTERRUPTED`. Recovery preserves recent processing and existing terminal records.
- `d8cea4b` — `fix: reconcile expired work throughout application lifetime`
  - A lifecycle-owned recovery task reconciles expired round leases and stale exports at startup and every five seconds, including leases that were still valid when the new process started.
  - Recovery continues after storage outages and is cancelled/awaited on application shutdown.
  - Shutdown cancels/awaits blocked round workers before pausing their owned rounds. Completed tasks leave the executor registry using an identity-checked callback; existing waiters retain their task reference.
  - Storage failures during background execution preserve the last complete answer checkpoint and pause the round when storage permits, rather than turning a database fault into a respondent failure. If storage remains unavailable, lease recovery handles the round later.

## TDD evidence

1. Auth/template/schema RED: `test_auth_api.py` + `test_database_models.py` → **5 failed, 15 passed**. Failures showed the previous CSRF code, public template access, and duplicate indexes. GREEN across auth service/API, schema, legacy API, research API, and round API → **41 passed**.
2. Storage boundary RED: `test_storage_failures.py` → **14 failed** because driver errors escaped and the API returned generic 500 responses. GREEN with database session/auth/executor/export regressions → **40 passed**.
   - Faults were injected at the external driver edge while real SQLite/SQLAlchemy transactions verified that the last committed value survived rollback. This is not a live PostgreSQL outage test.
3. Export main RED: **5 failed, 6 passed** for missing JSON metadata, missing question columns, CAS/storage finalization leaving `processing`, and absent stale recovery. An initial test-fixture setup mistake used `kind` instead of the answer discriminator `type`; it was corrected and the proper RED run recorded before production changes. First focused GREEN → **31 passed**.
4. Export follow-up RED: **2 failed, 18 passed** for the global inference summary leaking into filtered output and missing canonical resource IDs in storage logs. Focused export/API/storage/protocol GREEN → **36 passed**.
5. Recovery/executor RED: **6 failed, 6 passed** for future-lease recovery, stale export lifecycle recovery, recovery retry/stop, retained completed tasks, uncancelled blocked shutdown workers, and storage faults recorded as respondent failures. Focused GREEN with state-machine/API/export/storage regressions → **55 passed**.

## Final verification

After all production and test changes:

```text
backend/.venv/bin/python -m pytest backend/tests -q
157 passed in 3.70s

backend/.venv/bin/python -m compileall -q backend/app backend/tests backend/alembic
exit 0

git diff --check
exit 0
```

The full backend suite passed on the first final full-suite run; no failed full-suite run is omitted. The checkout was clean after the four implementation commits and before this report was added. Self-review checked exception propagation/rollback, owner-scoped exports, preserved immutable configuration, exact selection, stale-record terminal guards, expired-lease CAS behavior, task retention/wait ordering, shutdown cancellation, and log sanitization.

## Operational limits and coordination notes

- A database that is continuously unavailable cannot accept a failed-state write. The request still returns a safe failure; startup/periodic recovery completes the durable state transition once storage returns. Export records become stale after five minutes; round leases retain their existing expiry policy. Recovery requires a running application process and working storage.
- This remediation ran repository/API unit and integration tests, including real SQL transaction rollback and PostgreSQL migration SQL compilation. It did not run a live PostgreSQL process-kill/outage exercise.
- Removing indexes from the initial migration affects fresh databases. A database that already applied the older initial migration retains those redundant indexes until a forward maintenance migration removes them; unique constraints and behavior remain correct.
- The frontend owner was notified to update the frontend error catalog to `CSRF_INVALID`, including same-origin rejection handling. Frontend/i18n edits were outside this backend task. `EXPORT_GENERATION_INTERRUPTED` is now a durable export-record error code and can use the existing export-failure UI treatment.
- Default sandbox git writes were denied; the precise authorized git staging/commit commands succeeded after tool escalation. No work remained blocked by approval review.
