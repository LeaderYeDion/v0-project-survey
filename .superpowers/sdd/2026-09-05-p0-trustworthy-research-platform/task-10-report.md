# Task 10 report: verification closure and living documentation

## Status

Task 10 completed the daemon-independent automated/static subset that could be executed on this workstation and replaced every living README/deployment manual with the current PostgreSQL/Compose/application-user architecture. It also created the evidence-linked P0 verification record and exact daemon-ready handoff commands. The required full matrix was not completed: `docker compose build` was **NOT RUN**, and all live Docker/PostgreSQL/browser checks remain pending.

The correct release status is **implementation complete; the executed non-Docker automated/static subset passes; the required full matrix and live acceptance remain pending**. Complete P0 is not marked complete because `docker compose build`, Docker daemon readiness, live PostgreSQL/persistence/backup/restore, five-account, five-viewport browser, and optional public-profile checks were not executed.

## Files

Rewritten:

- `README.md`
- `docs/PROJECT_ITERATION.md`
- `backend/README.md`
- `deploy/README.md`
- `deploy/RUNBOOK.md`
- `deploy/ARCHITECTURE.md`
- `deploy/SECURITY.md`
- `deploy/TROUBLESHOOTING.md`

Created:

- `docs/verification/2026-09-05-p0-verification.md`
- `.superpowers/sdd/2026-09-05-p0-trustworthy-research-platform/task-10-report.md`

Updated local SDD ledger:

- `.superpowers/sdd/2026-09-05-p0-trustworthy-research-platform/progress.md`

Review-fix round 1 additionally changed:

- `deploy/scripts/common.sh`
- `deploy/tests/deployment-contract.test.mjs`

and corrected the current security/verification wording in the README, backend README, project iteration document, RUNBOOK, SECURITY, TROUBLESHOOTING, and verification record.

## Required context review

Before editing, read the complete Task 10 brief, approved 466-line design, 857-line full plan, current ledger, complete Task 1–9 reports, root/backend README, project iteration document, all five deployment manuals, current Compose file, Dockerfiles, entrypoint, npm scripts, and lifecycle/backup/restore scripts.

The plan review found no tracked implementation blocker. One local operational migration issue was identified without exposing or mutating secrets: the ignored `deploy/config/deploy.env` on this workstation still uses the replaced July host-process keys and lacks current PostgreSQL/Compose keys. Current docs now explain that `docker:init` intentionally preserves existing credentials and that operators must safely move/replace this legacy file before reinitializing.

## Fresh pre-document verification

Initial branch/worktree evidence:

```text
branch: real-backend-v1
HEAD: 99522df
git status --short: no output
```

Playwright prerequisite:

```text
command -v npx: exit 0
/Users/mymac/.local/state/fnm_multishells/39179_1788664171453/bin/npx
```

Executed non-Docker automated/static subset (not the complete required matrix):

```text
backend pytest: 127 passed in 2.92s; wall 3.13s
frontend Node tests: 114 passed, 0 failed; runner 312.665ms; wall 0.49s
tsc --noEmit: exit 0; wall 0.71s
Next build: exit 0; compile 2.5s; 5/5 static pages; wall 3.86s
deploy Node tests: 41 passed, 0 failed; runner 2.408s; wall 2.44s
shell syntax: exit 0; wall 0.00s
docker compose config --quiet: exit 0; wall 0.24s
fully specified public-profile Compose render: exit 0; wall 0.25s
docker compose build / npm run docker:build: NOT RUN; daemon readiness gate did not pass
```

The exact bare Compose config command emitted six non-failing warnings because it does not load the private env file and three database variables defaulted to blank twice during interpolation. The fully specified non-secret static render emitted no output.

## Build environment evidence

The normal sandbox production build stopped producing output after entering Turbopack and was explicitly cancelled after 117.83 seconds, exit 130. The unchanged command was rerun with approved permission because Turbopack needs a helper process/internal port; it passed.

Successful builds retain the existing warnings:

```text
Using external babel configuration from .babelrc
It looks like there is a custom Babel configuration that can be removed.
Skipping validation of types
```

`npm run typecheck` was separately green, so the Next built-in type-skip was not treated as type evidence. The Babel cleanup remains a non-blocking out-of-scope issue.

## Docker daemon evidence and live blocker

The first sandbox `docker info --format '{{json .ServerVersion}}'` exited 1 with permission denied on `/Users/mymac/.docker/run/docker.sock`. The required approved external probe did not return inside its bounded window and was explicitly interrupted, exit 130, without ServerVersion. One final bounded retry before documentation also failed to return and was terminated. Task 9 had already recorded Docker Desktop `Status starting` and an Engine API `/info` 500.

Because daemon readiness was not established, the following were intentionally not run and are not reported as passed:

- Docker image build and core Compose up;
- live Alembic, mounted seed, UID 10001 bootstrap, SQL repository transactions;
- persistence smoke, backend interruption, ordinary down/up and ID retention;
- real custom-format backup and isolated restore;
- all five application credentials, `/auth/me`, isolation, logout and post-logout 401;
- current five-viewport Playwright workflows and console/overflow assertions;
- optional Quick Tunnel public login/health/owned-resource request.

## Documentation decisions

- P0-A remains a clearly dated historical completion.
- P0-B and P0-C are `实现完成/验收待补`; they are not marked complete.
- The full P0 stage is `实现完成/验收待补` until all 12 completion criteria pass.
- `MemoryRepository` is described only as a protocol-conforming test double/no-database composition, never as the deployed data source.
- The old host-PID, two host-port, process-memory history, and shared deployment identity descriptions were removed from live sections. The July scheme remains only in a clearly labeled historical entry and legacy-config migration guidance.
- Five application users and optional outer deployment credentials are explicitly separate identities.
- Ordinary down/restart/build-up and failed-start rollback preserve the named volume; only explicit `down --volumes` is destructive.
- Backup, restore confirmation, version immutability, run recovery, analytics scope, export traceability, Mock boundary, known build warnings, and exact acceptance commands are documented.

## Post-document verification

Fresh critical rerun after all requested living docs and the verification report were written:

```text
npm run typecheck: exit 0; wall 1.04s
npm run build: exit 0; compile 2.6s; 5/5 static pages; wall 4.29s
backend pytest: 127 passed in 3.31s; wall 3.62s
```

The post-doc build used the same approved environment and retained the same non-failing Babel/type-skip warnings.

Documentation structure check:

```text
markdown structure and local links: ok (9 files)
```

The final stale-claim scan matched only the backend README sentence that explicitly labels `MemoryRepository` as a test double rather than the deployment data source. It found no live claim that history is process memory/restart-lost, a shared outer credential is the application identity, the database is absent, or P0-B/P0-C are unstarted. `git diff --check` exited 0. The staged diff and final Git state were inspected immediately before/after commit.

## Review-fix round 1

Review against commit `4392974` found one implementation hardening opportunity and several documentation precision problems.

The credential-file hardening followed a test-first RED/GREEN cycle. The focused RED command was:

```text
node --test --test-name-pattern='private credential validation rejects symbolic links' deploy/tests/deployment-contract.test.mjs
```

It failed 0/1 because a symlink to a mode-600 target produced the existing generic mode error instead of the required explicit symbolic-link rejection. `assert_private_file` was then changed to reject `-L` before checking file type or mode. The unchanged focused command passed 1/1 (45.813 ms), and the complete deployment suite passed 42/42 (2260.170 ms).

Documentation corrections:

- seed plaintext is described at every current touchpoint: the mode-600 host file is mounted read-only and copied during root bootstrap to `/app/runtime/seed-users.json`, owned by `survey`/UID 10001 with mode 600; the entrypoint does not delete it, and it disappears with the container writable layer when the container is replaced or removed;
- the verification record instructs each viewport to collect both `console error` and `console warning`, requiring both counts to be zero;
- every summary describes the green matrix as the executed non-Docker automated/static subset and explicitly records `docker compose build` as NOT RUN;
- the RUNBOOK limits direct unauthenticated health curl to `DEPLOY_AUTH_ENABLED=false` and gives a short-lived mode-600 curl-config method valid in both modes;
- TROUBLESHOOTING states exactly what `docker:status` prints, makes clear that `Local URL` is configuration rather than a reachability probe, and explains its early failure behavior when daemon/Compose is unavailable.

Fresh review-fix verification:

```text
focused symlink regression: 1 passed; 45.813 ms
complete deploy tests: 42 passed; 2260.170 ms
shell syntax: exit 0
typecheck: exit 0
frontend tests: 114 passed; 416.849 ms
backend tests: 127 passed in 3.52 s
production build: exit 0; compile 3.4 s; 5/5 static pages
markdown structure and local links: 10 files; exit 0
git diff --check: exit 0
```

The build retained the known custom-Babel and skipped built-in type-validation warnings; the independent typecheck passed. Docker/live/browser acceptance was not rerun and remains pending because this documentation/hardening review did not establish a ready daemon.

## Self-review

- Compared each living claim against current `compose.yaml`, Dockerfiles, entrypoint, npm lifecycle scripts, auth/session code, round recovery code, prior task reports, and the approved design.
- Kept static contracts and live observations in separate report sections and status labels.
- Confirmed no password, private env value, seed content, session token, CSRF token, or backup content was read into documentation or tool output.
- Confirmed deployment commands target current Compose scripts, not the replaced host-PID flow.
- Confirmed public profile remains optional and application users remain authoritative when outer auth is enabled.
- Confirmed Playwright was not opened against a nonexistent service; only its `npx` prerequisite and exact future CLI workflow were recorded.
- Confirmed the initial Task 10 commit changed documentation only; review-fix round 1 changed only the private-file validator and its regression test outside documentation, without changing Dockerfiles, Compose, or product behavior.

## Commit

Initial Task 10 commit: `4392974 docs: record P0 verification with live acceptance pending`.

The review-fix commit identifier is provided in the task handoff because adding a commit's own identifier to this tracked report would change that commit.
