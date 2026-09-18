# Final deployment and documentation remediation — 2026-09-18

## Scope and implementation

- Resumed on a clean `real-backend-v1` checkout at `6c16ec9`. Existing backend/frontend commits were preserved; no worktree or subagent was created.
- Implementation commit: `963de15` — `fix: quiesce applications and recover safely during database restore`.
- Addressed the final review finding that `pg_restore --clean` ran while frontend/backend/executor connections remained online, and the related premature implementation-complete documentation claims.

## Restore behavior

1. Require exact confirmation, regular non-symlink/nonempty mode-600 custom-format backup, private deployment/seed files, valid settings and non-system database. Print the configured target. Read-only Compose validation, archive TOC parsing and `SELECT current_database()` verify the archive/actual target before stopping services or changing database objects. The target db must already run; the current backend image must be built.
2. Stop cloudflared/frontend/backend; clear the recorded public URL; ensure only db is started. Ordinary PostgreSQL volume is retained.
3. Import into the exact configured database using `--single-transaction --clean --if-exists --exit-on-error --no-owner --no-privileges`.
4. Run an isolated one-off backend with `--prepare-only`: existing root secret-copy/privilege-drop bootstrap, Alembic upgrade and existing exact-five idempotent seed CLI, then exit without Uvicorn. Normal entrypoint behavior remains migration → seed → Uvicorn. Invalid entrypoint arguments fail before side effects.
5. Restart backend/frontend using Compose health gates, then verify same-origin HTTP health using the existing private curl configuration flow. Public tunnel remains stopped until explicitly re-enabled.
6. Any failure after quiescing begins triggers another app/tunnel stop, preserves db/volume, exits nonzero and prints failure stage and shell-escaped commands to confirm app shutdown, start db only if necessary, and retry with the same project/database/config/seed/backup. If Docker cannot confirm shutdown, print an explicit error rather than claim services stopped. Guidance never prints credentials and never instructs automatic app startup or volume deletion.

Import rollback is limited to its PostgreSQL transaction. Migration/seed and restart are separate stages; later failure is handled by keeping services stopped, not by claiming whole-workflow rollback.

## TDD evidence

- Initial new lifecycle/entrypoint suite: **13 failed, 3 passed**. Failures showed the missing validation/call order, stop-on-failure/recovery guidance, preparation-only behavior and invalid-argument rejection. Existing normal start and migration/seed failure short-circuit cases already passed.
- Minimal implementation: **16/16 passed**.
- First full deployment run: **59/60 passed**; the previous confirmed-restore test fixture omitted the newly required private seed file. Updated that external-boundary fixture with seed/target/health behavior; full suite **60/60 passed**.
- Additional exact recovery-command assertions: **6 failed, 10 passed**, because output lacked executable app-stop/db-only-start commands. Added these commands; focused **16/16**, final full suite **60/60 passed**.
- Tests execute real Bash scripts and assert external calls/order, abort behavior and error guidance. Docker/curl/id/migration/server executables are controlled substitutes because the Docker engine is unavailable. These tests do not establish actual PostgreSQL restore correctness.

## Live hook

`deploy/tests/persistence-smoke.sh` now starts the isolated frontend/backend/db on a different local port (default 3001, override `RESTORE_SMOKE_PORT`), then invokes the production restore twice while the isolated application exists. It verifies revision `20260912_0002`, exactly `researcher01`–`researcher05`, application login, the original restored round ID and source project count. Existing main-project backend restart/down-up/backup behavior remains.

The hook cleans only its generated isolated project's volume; main-project smoke data and backup remain. Its syntax and existing wiring contracts pass. **Live execution is NOT RUN**; Docker readiness failed before any live build/up/restore attempt.

## Fresh verification

| Command/check | Result |
| --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests -q` | 167 passed in 4.43 s |
| `npm run test:frontend` | 138 passed, 0 failed; 485.385 ms |
| `node --test deploy/tests/*.test.mjs` | 60 passed, 0 failed; final 8.003 s |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0; compile 2.9 s; 5/5 pages |
| `bash -n` for each deploy script/test and backend entrypoint | exit 0 |
| Explicit non-production env/seed + public profile Compose config | exit 0; no output |
| Nine living Markdown files: fences and local link targets | passed |
| `git diff --check` | exit 0 |
| Bounded `docker info --format '{{.ServerVersion}}'` | exit 1 in ~0.37 s; local Docker socket absent |

The production build ran with approved helper-process access, based on the previously established sandbox limitation. It retains the existing custom-Babel warning and Next built-in type-validation skip; independent TypeScript passes. npm also printed an informational major-version notice; no dependency update was made.

## Documentation and status

Updated README, PROJECT_ITERATION, backend README, all five deployment manuals and the verification record. Current sections now carry 167 backend / 138 frontend / 60 deploy results, migration `20260912_0002`, stable exports and executor/storage fixes, the outer-auth/application split, request/history fixes and the restore lifecycle/failure workflow. Earlier 127/114/44 results remain only in explicitly historical evidence.

The 2026-09-13 browser evidence (4/4) is attributed to the frontend remediation report: actual Next/Chrome with an HTTP backend fixture, not live PostgreSQL or full five-viewport acceptance. Current Docker evidence is the missing socket, not the prior historical `starting`/timeout symptom.

Backend/frontend remediation already passed the parent's static review. At this report's initial write, restore final review is **pending**; living docs deliberately do not mark static implementation handoff approved until that review passes. Full P0 remains **live acceptance pending**, including images/build/up, real PostgreSQL/volume/backup-restore, five users, five viewports/autosave, and optional public tunnel.

## Review and operational limits

Self-review covered no-mutating preflight, database-only startup, shutdown before import, single-transaction restore, preparation-before-start, health-failure cleanup, no volume deletion, ordinary boot compatibility, shell-quoted recovery targets, private auth handling and isolated smoke port/project boundaries. No production database or deployment was changed during this task.

The script depends on Docker being able to stop services and assumes operators do not concurrently restart application services or run separate database writers during maintenance. It explicitly reports inability to confirm shutdown. Private seed format/count validation occurs in the existing backend seed CLI before server startup; a malformed seed makes restore preparation fail with the application stopped.
