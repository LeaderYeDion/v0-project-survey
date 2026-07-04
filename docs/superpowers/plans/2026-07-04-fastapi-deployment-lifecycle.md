# FastAPI Deployment Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Quick Tunnel deployment so FastAPI starts, is health-checked, is reported in status, and is safely stopped with Next.js.

**Architecture:** Cloudflare continues to expose only loopback Next.js on port 3000. The deployment lifecycle additionally owns loopback FastAPI on port 8000, while authenticated same-origin `/survey-api/*` requests reach it through the existing Next.js Rewrite.

**Tech Stack:** Bash, Node.js test runner, Next.js 16, Python 3.14.6, FastAPI/Uvicorn, Cloudflare Quick Tunnel.

---

### Task 1: Lock the FastAPI deployment contract

**Files:**
- Modify: `deploy/tests/deployment-contract.test.mjs`

- [ ] **Step 1: Write failing tests**

Add contract tests which require:

```js
test("manages FastAPI as a loopback-only deployment process", async () => {
  const common = await read("deploy/scripts/common.sh")
  const start = await read("deploy/scripts/start.sh")

  assert.match(common, /backend/)
  assert.match(start, /uvicorn/)
  assert.match(start, /--host.*BACKEND_HOST/s)
  assert.match(start, /--port.*BACKEND_PORT/s)
  assert.match(start, /survey-api\\/health/)
})
```

Also require backend rollback, stop, status, shutdown verification, prerequisites, log output, and direct/proxied health checks.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
```

Expected: failures because current scripts only know `next` and `cloudflared`.

- [ ] **Step 3: Keep the failing tests unchanged**

Do not weaken regexes or remove assertions while implementing the lifecycle.

### Task 2: Add backend configuration and process primitives

**Files:**
- Modify: `deploy/config/deploy.env.example`
- Modify: `deploy/scripts/init-config.sh`
- Modify: `deploy/scripts/common.sh`
- Modify: `deploy/scripts/check-prerequisites.sh`

- [ ] **Step 1: Extend configuration**

Generate and document:

```bash
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
SURVEY_BACKEND_URL=http://127.0.0.1:8000
```

Validate exact loopback values in `load_deploy_env`.

- [ ] **Step 2: Generalize listener helpers**

Use host/port parameters:

```bash
port_listener() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

assert_loopback_listener() {
  local host="$1"
  local port="$2"
  # require host:port and reject wildcard listeners
}
```

- [ ] **Step 3: Add a backend process role**

Accept `backend` in PID helpers and identify only a process whose working directory is `backend/` and whose command contains the project virtualenv Uvicorn entrypoint and `app.main:app`.

- [ ] **Step 4: Add prerequisite checks**

Require `backend/.venv/bin/python`, `backend/.venv/bin/uvicorn`, exact Python 3.14.6, and successful imports of FastAPI and Uvicorn. Print a bootstrap instruction if missing.

- [ ] **Step 5: Run the deployment contract test**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
```

Expected: lifecycle tests remain RED until start/stop/status are implemented.

### Task 3: Own FastAPI in start and rollback

**Files:**
- Modify: `deploy/scripts/start.sh`

- [ ] **Step 1: Add backend state and rollback**

Track `STARTED_BACKEND`; after stopping Tunnel and Next.js during rollback, safely stop the backend.

- [ ] **Step 2: Reject stale backend state**

Before building, reject an existing backend PID, matching Uvicorn process, or port 8000 listener.

- [ ] **Step 3: Start and verify FastAPI**

Start:

```bash
(
  cd "$PROJECT_ROOT/backend"
  nohup "$PROJECT_ROOT/backend/.venv/bin/uvicorn" app.main:app \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT" >"$backend_log" 2>&1 &
  printf '%s\n' "$!" >"$(pid_file_for_role backend)"
)
```

Wait for `/api/health`, verify process identity, and assert loopback-only port 8000 before starting Next.js.

- [ ] **Step 4: Verify the authenticated proxy**

After Next.js starts, require authenticated `/survey-api/health` to return 200 and unauthenticated access to return 401.

- [ ] **Step 5: Verify the public proxy**

After Tunnel startup, require authenticated `${public_url}/survey-api/health` to return 200 in addition to the existing page check.

- [ ] **Step 6: Run the deployment contract test**

Expected: start and rollback assertions pass.

### Task 4: Extend stop, status, and shutdown verification

**Files:**
- Modify: `deploy/scripts/stop.sh`
- Modify: `deploy/scripts/status.sh`
- Modify: `deploy/scripts/verify-shutdown.sh`

- [ ] **Step 1: Stop FastAPI**

Stop in this order:

```bash
stop_role "cloudflared"
remove_public_url
stop_role "next"
stop_role "backend"
```

- [ ] **Step 2: Include FastAPI in status**

`RUNNING` requires valid backend, Next.js and Tunnel processes, URL state, and both loopback listeners. Missing components return `DEGRADED`; mismatched identities or listeners return `UNSAFE`.

- [ ] **Step 3: Include FastAPI in shutdown verification**

Reject backend PID files, matching Uvicorn processes, or listeners on ports 3000 and 8000.

- [ ] **Step 4: Run deployment contract tests and Shell syntax checks**

Run:

```bash
node --test deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh
```

Expected: all tests and syntax checks pass.

### Task 5: Update deployment documentation

**Files:**
- Modify: `deploy/README.md`
- Modify: `deploy/ARCHITECTURE.md`
- Modify: `deploy/RUNBOOK.md`
- Modify: `deploy/SECURITY.md`
- Modify: `deploy/TROUBLESHOOTING.md`

- [ ] **Step 1: Document the three-process architecture**

Show Cloudflare → Next.js → FastAPI and state that only port 3000 is tunneled.

- [ ] **Step 2: Document setup and lifecycle**

Require `bash backend/scripts/bootstrap.sh` before deployment and describe `backend.log`, port 8000, backend status, and stop verification.

- [ ] **Step 3: Document operational limitations**

State that FastAPI restart loses in-memory runs and history, and add backend/proxy health troubleshooting commands.

- [ ] **Step 4: Check documentation consistency**

Run:

```bash
rg -n "只.*Next|Next\\.js.*cloudflared|TCP 3000|两个进程" deploy --glob '*.md'
```

Update stale statements so they include FastAPI where appropriate.

### Task 6: Full verification and commit

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run regression verification**

```bash
backend/.venv/bin/python -m pytest backend/tests -q
node --test tests/*.test.mjs deploy/tests/*.test.mjs
npm run typecheck
npm run build
git diff --check
```

- [ ] **Step 2: Exercise the real local lifecycle**

With an existing valid `deploy.env`, run `npm run deploy:start`, verify direct and proxied health endpoints and `npm run deploy:status`, then run `npm stop` and `npm run deploy:verify-stopped`. Always stop processes on exit.

- [ ] **Step 3: Review the diff**

Confirm no credentials, runtime logs, PID files, `.idea/`, or unrelated files are staged.

- [ ] **Step 4: Commit**

```bash
git add deploy docs/superpowers/plans/2026-07-04-fastapi-deployment-lifecycle.md
git commit -m "feat: deploy FastAPI with the survey application"
```
