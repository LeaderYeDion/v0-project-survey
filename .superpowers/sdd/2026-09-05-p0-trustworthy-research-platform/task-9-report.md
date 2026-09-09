# Task 9 report: three-service Docker deployment, persistence, backup, and restore

## Status

The Task 9 implementation and its static/offline verification are complete.
The repository now defines an independently built frontend image, an
independently built backend image, PostgreSQL 17, an optional Cloudflare Quick
Tunnel profile, a persistent named database volume, and guarded lifecycle,
backup, restore, and persistence-smoke entrypoints.

The required live Docker build/up and PostgreSQL persistence pass could not be
executed because Docker Desktop never reached a usable daemon state in this
environment. This report therefore does **not** claim a live Compose,
persistence, backup/restore, public-tunnel, or deferred PostgreSQL pass. The
exact daemon evidence and the checks that remain are recorded below.

Task 10 documentation was intentionally left untouched: the root README,
deployment manuals, and final project iteration record still need their
planned final documentation update.

## Files

Created:

- `.dockerignore`
- `Dockerfile`
- `backend/.dockerignore`
- `backend/Dockerfile`
- `backend/docker-entrypoint.sh`
- `compose.yaml`
- `deploy/scripts/backup-db.sh`
- `deploy/scripts/restore-db.sh`
- `deploy/tests/docker-compose-contract.test.mjs`
- `deploy/tests/persistence-smoke.sh`

Modified:

- `.gitignore`
- `backend/app/main.py`
- `backend/requirements.txt`
- `backend/tests/test_health.py`
- `deploy/config/deploy.env.example`
- `deploy/scripts/check-prerequisites.sh`
- `deploy/scripts/common.sh`
- `deploy/scripts/init-config.sh`
- `deploy/scripts/start.sh`
- `deploy/scripts/status.sh`
- `deploy/scripts/stop.sh`
- `deploy/scripts/verify-shutdown.sh`
- `deploy/tests/deployment-contract.test.mjs`
- `next.config.mjs`
- `package.json`

## Implementation

### Images and startup

- The frontend uses separate dependency, builder, and non-root standalone
  runtime stages. The builder runs `npm ci`, `npm run typecheck`, and
  `npm run build`; the runtime contains only the standalone server, static
  assets, and `public` directory.
- The backend uses a wheel-builder stage and a non-root runtime stage. Direct
  backend requirements are exact-version locked, wheels are installed in the
  runtime with `--no-index`, and source tests/local environments are excluded
  from the image context.
- The backend entrypoint refuses an unreadable seed secret, applies
  `alembic upgrade head`, invokes the existing idempotent `seed-users` CLI,
  and only then `exec`s Uvicorn.
- The backend `/api/health` endpoint now verifies database connectivity and
  the exact Alembic head (`20260905_0001`) when a database session factory is
  configured. It returns 503 with non-sensitive `unavailable` or
  `migration_pending` states instead of marking an unusable database healthy.

### Compose trust boundaries

- `db`, `backend`, and `frontend` are separate services. PostgreSQL uses the
  named `survey_postgres_data` volume.
- Only the frontend is host-published, exactly at
  `127.0.0.1:${LOCAL_PORT:-3000}:3000`. Neither backend nor PostgreSQL has a
  host port.
- Database and application traffic use an `internal: true` network. The
  frontend additionally joins the edge network; optional `cloudflared` joins
  only that edge network.
- Backend startup depends on healthy PostgreSQL; frontend startup depends on
  the database-aware healthy backend; cloudflared depends on the healthy
  frontend.
- The seed file is passed as a read-only Compose secret rather than copied into
  either image or mounted as a source tree.
- The frontend container health probe supports both the default disabled
  outer gate and an explicitly enabled outer Basic-auth gate.
- `cloudflared` is isolated behind the `public` Compose profile and targets the
  frontend service over the edge network.

### Safe lifecycle and private configuration

- Added the full `docker:init`, `docker:build`, `docker:up`, `docker:status`,
  `docker:logs`, `docker:down`, `docker:backup`, and `docker:restore` npm
  surface. Existing `deploy:*` aliases remain as compatibility entrypoints.
- Configuration loading requires exact mode 600 for the deployment env and
  seed file, validates port/project/database identifiers, rejects unsafe or
  placeholder passwords, and allows explicit process settings to override an
  env file for isolated verification.
- Initialization never overwrites a private file. It validates and preserves
  each existing env/seed file independently and creates only a missing one,
  covering an upgrade from a partial legacy configuration.
- Startup validates Docker and Compose, builds unless `--no-build` is given,
  waits for dependency health, checks the same-origin backend path, optionally
  starts/verifies a Quick Tunnel, and rolls a partial failure down without
  removing any volume.
- Ordinary stop is `compose --profile public down --remove-orphans` with no
  `-v`/`--volumes`. Shutdown verification checks containers and transient
  public-URL state but deliberately neither inspects nor deletes the volume.
- Status reports Compose health, local/public URLs, the labeled database
  volume, and the current Alembic revision.

### Backup, restore, and persistence smoke

- Backup runs `pg_dump --format=custom --no-owner --no-privileges` inside the
  database container, writes through a private temporary file, rejects an
  empty dump, atomically renames it, and leaves the timestamped result at mode
  600 below Git-ignored `deploy/backups/`.
- Restore validates argument count, exact `--confirm`, existence, non-empty
  content, and mode 600 before invoking Docker. It prints the exact Compose
  project/database target and uses `pg_restore --clean --if-exists
  --exit-on-error` only against the configured application database.
- The smoke script encodes the required live proof: two seeded-user logins;
  project/questionnaire/round creation; exact cross-owner 404 checks for
  project, questionnaire, immutable version list, and round; an analytics
  population assertion; backend restart; ordinary down/up; persistence checks;
  private backup; and restore/project-count comparison in an explicitly
  isolated Compose project/database.
- Isolated cleanup is the only place that uses `down --volumes`, and it targets
  the generated random smoke project. Daily stop, failed-start rollback, and
  normal down/up never delete a volume.

## TDD evidence

### Initial Compose/deployment RED

The contract tests were created/rewritten before the Compose implementation:

```text
node --test deploy/tests/docker-compose-contract.test.mjs deploy/tests/deployment-contract.test.mjs

tests 14
pass 1
fail 13
```

Failures were the intended missing Task 9 surface: Compose, both Dockerfiles,
the migration/seed entrypoint, new lifecycle commands, backup/restore/smoke
scripts, private configuration, health dependencies, and persistent-volume
safety.

### Database health RED/GREEN

Database-aware health tests were added before the health implementation. The
first focused run observed `1 passed, 2 failed`; an additional outdated-head
case also failed before implementation. After adding the database/Alembic
probe, `backend/tests/test_health.py` passed `4/4`.

### Wrapper and self-review RED/GREEN

- An explicit environment override contract failed with `survey` rather than
  the required `survey_isolated`; preserving explicit process values around
  env-file loading made it pass.
- A failed-start rollback contract failed because the fake `compose up`
  failure never produced `compose down`; marking startup attempted before the
  up call made it pass without adding volume deletion.
- Compose contracts failed while the seed file was a bind mount, the frontend
  health probe could not cross enabled outer auth, and the backend had no
  locked wheel stage. They passed after the secret, auth-aware probe, and
  builder/runtime changes.
- The isolated-restore contract failed `1/1` because inherited source project
  settings could override the isolated env. Explicit isolated project,
  database, and env-file settings made it pass `1/1`.
- The curl-config injection contract failed `1/1` because a password
  containing `"` was accepted. URL-safe outer-password validation made it
  pass `1/1`.
- The example PostgreSQL password contract failed `1/1` because the
  syntactically valid placeholder was accepted. Explicit placeholder rejection
  made it pass `1/1`.
- The partial-configuration initializer contract failed `1/1` because an
  existing env blocked creation of a missing seed file. Per-file
  preserve-or-create behavior made it pass `1/1` without changing the
  existing file.

## Final static/offline verification

Fresh final deployment contract run:

```text
node --test deploy/tests/*.test.mjs

tests 35
pass 35
fail 0
```

Fresh shell and Compose model validation:

```text
bash -n deploy/scripts/*.sh backend/docker-entrypoint.sh deploy/tests/persistence-smoke.sh
exit 0

COMPOSE_PROJECT_NAME=survey-task9 LOCAL_PORT=3000 POSTGRES_DB=survey \
POSTGRES_USER=survey \
POSTGRES_PASSWORD=task9-local-postgres-password-2026 \
SIMULATION_TERMINATION_ENABLED=false DEPLOY_AUTH_ENABLED=false \
DEPLOY_USERNAME= DEPLOY_PASSWORD= \
docker compose --env-file deploy/config/deploy.env config --quiet
exit 0
```

Application regression suites:

```text
backend/.venv/bin/python -m pytest backend/tests -q
127 passed in 3.63s

npm run test:frontend
114 passed, 0 failed

npm run typecheck
exit 0
```

Backend dependency validation under the repository's Python 3.14.6 virtual
environment:

```text
backend/.venv/bin/python -m pip check
No broken requirements found.

backend/.venv/bin/python -m pip install --dry-run --no-index \
  --requirement backend/requirements.txt
exit 0; every direct requirement was already satisfied at its exact version
```

The normal-sandbox production build first failed with a Turbopack internal
error while creating a process/binding a port (`Operation not permitted`). Per
the sandbox policy, the identical command was rerun with required escalation:

```text
npm run build
exit 0
Next.js 16.1.6 compiled successfully, generated 5/5 static pages, and listed
the expected routes.
```

The existing non-failing custom Babel warning remains. Type checking passed
separately. `git diff --check` exited 0.

`shellcheck` is not installed. `npm run lint` cannot run because this existing
project script has no installed `eslint` binary/dependency; it exited 127.
Neither unavailable tool produced a source diagnostic, and both requested
language/test/build paths above passed.

## Docker daemon evidence and live limitation

Installed clients were available:

```text
Docker version 29.5.3, build 662d6f4
Docker Compose version v5.1.4
```

The Docker application was started with an approved escalated `open -a Docker`
and returned exit 0, but the daemon did not become usable:

- normal-sandbox `docker info` could not access the Docker socket;
- the required escalated `docker info` remained unavailable and returned an
  Engine API v1.54 `/info` HTTP 500 after a bounded wait;
- an escalated `docker version` produced client information only before the
  bounded call was interrupted;
- repeated `docker desktop status` checks remained `Status starting` under
  session `4223a6cf-cb75-4f2e-8b8c-9ea7fb49fda1`;
- the final bounded recheck could not create Docker Desktop's host log under
  the managed sandbox, was interrupted after 10 seconds, and exited 1 with
  `Could not retrieve status. Is Docker Desktop running?`.

The long UI state probe used while trying to diagnose Docker Desktop was also
controller-interrupted; no workspace write was lost. Bounded CLI checks were
used afterward, and no further indefinite daemon wait was attempted.

Consequently, the following required live commands/checks remain **not run**:

- `npm run docker:build`
- `npm run docker:up`
- `bash deploy/tests/persistence-smoke.sh`
- optional `cloudflared` profile/public health
- live PostgreSQL Alembic upgrade/downgrade
- live PostgreSQL auth repository and idempotent mounted seed synchronization
- live PostgreSQL owner isolation/version-read/race behavior
- live PostgreSQL transaction/lease behavior
- live PostgreSQL analytics snapshot behavior
- backend-restart and ordinary down/up persistence
- real custom-format backup and isolated restore

The static contracts and smoke script encode those boundaries, but are not a
substitute for running them against a ready engine. Task 10 or the next daemon-
available session must execute the list before final platform sign-off.

## Self-review

- Exposure: the rendered Compose model publishes only frontend loopback; no
  backend/database host ports or production source bind mounts exist.
- Readiness: application tiers are dependency-health gated, and backend health
  includes both PostgreSQL access and exact migration head.
- Privilege: both application runtime images declare non-root users.
- Secrets: local env/seed and generated backups are mode 600; secrets are not
  copied into images; unsafe/placeholder passwords fail closed.
- Durability: one named PostgreSQL volume is used; normal stop, normal restart,
  down/up, and failed-start cleanup never request volume deletion.
- Restore blast radius: confirmation and private-file checks occur before
  Docker; project/database targets are explicit, including the isolated smoke
  restore.
- Regression: all backend, frontend, deployment-contract, type, syntax,
  Compose-model, dependency, and production-build checks listed above passed.
- Scope: root/final documentation was deliberately deferred to Task 10.

## Commit

Commit message: `feat: deploy frontend backend and PostgreSQL with Docker`.
The resulting commit identifier is recorded in the task handoff because
embedding a commit's own identifier would change that identifier.
