# P0 Trustworthy Research Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete P0 platform with five seeded users, strict user-owned research data, durable PostgreSQL rounds, recoverable run controls, explicit analysis scopes, traceable exports, and independently deployable frontend/backend/database containers.

**Architecture:** The browser uses the Next.js frontend as a same-origin gateway to a FastAPI backend. FastAPI authenticates opaque database-backed sessions, enforces ownership at repository boundaries, persists immutable configuration versions and normalized round results in PostgreSQL, and runs the existing Mock engine through a checkpointed in-process executor. Docker Compose provides separate `frontend`, `backend`, and `db` services with a PostgreSQL named volume and an optional Cloudflare profile.

**Tech Stack:** Next.js 16.1.6, React 19.2.4, TypeScript 5.7.3, FastAPI 0.139.0, Pydantic 2.13.4, SQLAlchemy 2.x async, asyncpg, Alembic, pwdlib/Argon2, PostgreSQL 17 Alpine, Docker Compose, pytest, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-p0-trustworthy-research-platform-design.md`

## Global Constraints

- Work directly on branch `real-backend-v1`; do not create a worktree.
- No registration, email verification, password recovery, app-level user administration, project sharing, or cross-user administrator read access.
- Seed exactly five accounts named `researcher01` through `researcher05`; keep plaintext only in a Git-ignored mode-`600` file and store Argon2id hashes in PostgreSQL.
- Every project, questionnaire, configuration version, research round, analysis, and export must be reachable only through the authenticated owner.
- Cross-owner direct access returns `404 RESOURCE_NOT_FOUND`.
- Questionnaire and configuration versions are immutable after creation and include `schema_version`.
- Run interruption is checkpointed; backend restart converts lease-less active rounds to `paused` and never silently regenerates answers.
- Core Compose services are `frontend`, `backend`, and `db`; PostgreSQL data uses a named volume retained by ordinary `docker compose down`.
- Keep the existing Mock engine and bilingual `zh-CN`/`en-US` behavior; do not claim real AI support.
- Use tests first for every behavior change and verify the expected failure before implementation.
- Update `README.md`, `docs/PROJECT_ITERATION.md`, `backend/README.md`, and all live `deploy/` manuals only after verified behavior is known.

---

### Task 1: PostgreSQL domain and migration foundation

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/requirements-dev.txt`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/versions/20260905_0001_p0_schema.py`
- Create: `backend/app/db/__init__.py`
- Create: `backend/app/db/base.py`
- Create: `backend/app/db/session.py`
- Create: `backend/app/db/models.py`
- Create: `backend/app/repositories/protocols.py`
- Test: `backend/tests/test_database_models.py`
- Test: `backend/tests/test_database_session.py`

**Interfaces:**
- Produces: `DatabaseSettings.from_env() -> DatabaseSettings`, `create_session_factory(database_url: str) -> async_sessionmaker[AsyncSession]`, `Base`, and ORM rows for all tables in the approved spec.
- Produces: repository protocols consumed by Tasks 2–6.
- Consumes: existing Pydantic survey contracts only for JSON serialization boundaries; ORM models do not import API routers.

- [ ] **Step 1: Write metadata tests for the exact schema and immutable-version constraints**

```python
def test_p0_schema_contains_owned_research_graph() -> None:
    expected = {
        "users", "user_sessions", "projects", "questionnaires",
        "questionnaire_versions", "config_versions", "research_rounds",
        "round_respondents", "sessions", "messages", "responses",
        "inference_results", "export_records",
    }
    assert expected == set(Base.metadata.tables)

def test_top_level_resources_have_owner_path() -> None:
    assert "owner_user_id" in Base.metadata.tables["projects"].c
    assert {fk.target_fullname for fk in Base.metadata.tables["questionnaires"].foreign_keys} >= {"projects.id"}
    assert {fk.target_fullname for fk in Base.metadata.tables["research_rounds"].foreign_keys} >= {
        "projects.id", "questionnaires.id", "config_versions.id"
    }
```

- [ ] **Step 2: Run the schema tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_database_models.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'`.

- [ ] **Step 3: Add pinned persistence dependencies and focused database modules**

```text
sqlalchemy[asyncio]>=2.0,<2.1
asyncpg>=0.30,<1
alembic>=1.16,<2
pwdlib[argon2]>=0.2,<1
```

Define UUID primary keys, UTC timestamps, foreign keys with explicit delete behavior, unique constraints for usernames/version numbers/responses, JSONB columns, status check constraints, and indexes on every ownership/list path. `questionnaire_versions` and `config_versions` expose no update API.

- [ ] **Step 4: Implement strict environment settings and async session lifecycle**

```python
@dataclass(frozen=True)
class DatabaseSettings:
    url: str

    @classmethod
    def from_env(cls) -> "DatabaseSettings":
        value = os.environ.get("DATABASE_URL", "").strip()
        if not value.startswith("postgresql+asyncpg://"):
            raise RuntimeError("DATABASE_URL must use postgresql+asyncpg")
        return cls(url=value)

def create_session_factory(database_url: str) -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    return async_sessionmaker(engine, expire_on_commit=False)
```

- [ ] **Step 5: Run schema/session tests and verify GREEN**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_database_models.py backend/tests/test_database_session.py -q`

Expected: PASS.

- [ ] **Step 6: Generate the initial Alembic migration and inspect it against metadata**

Run: `cd backend && .venv/bin/alembic revision --autogenerate -m 'create P0 persistence schema'`

Expected: one migration whose upgrade creates all 13 tables and whose downgrade drops them in reverse dependency order.

- [ ] **Step 7: Commit the database foundation**

```bash
git add backend/requirements.txt backend/requirements-dev.txt backend/alembic.ini backend/alembic backend/app/db backend/app/repositories/protocols.py backend/tests/test_database_models.py backend/tests/test_database_session.py
git commit -m "feat: add PostgreSQL persistence schema"
```

---

### Task 2: Seeded users, authentication, sessions, and ownership dependency

**Files:**
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/security/passwords.py`
- Create: `backend/app/security/sessions.py`
- Create: `backend/app/repositories/auth.py`
- Create: `backend/app/services/auth_service.py`
- Create: `backend/app/api/auth.py`
- Create: `backend/app/api/dependencies.py`
- Create: `backend/app/cli.py`
- Modify: `backend/app/main.py`
- Modify: `deploy/scripts/init-config.sh`
- Modify: `.gitignore`
- Create: `deploy/config/seed-users.example.json`
- Test: `backend/tests/test_auth_service.py`
- Test: `backend/tests/test_auth_api.py`
- Test: `backend/tests/test_seed_users.py`

**Interfaces:**
- Produces: `CurrentUser(id: UUID, username: str, locale: Locale)` dependency.
- Produces: `AuthService.login(username, password) -> CreatedSession`, `logout(token) -> None`, `authenticate(token) -> CurrentUser`.
- Produces: CLI commands `seed-users --file PATH` and `reset-password --username NAME --password VALUE`.
- Consumes: `users` and `user_sessions` ORM rows and session factory from Task 1.

- [ ] **Step 1: Write failing authentication and seed tests**

```python
@pytest.mark.asyncio
async def test_login_stores_only_hashes(auth_service, auth_repository) -> None:
    await auth_repository.create_user("researcher01", hash_password("Initial-01!"), "zh-CN")
    created = await auth_service.login("researcher01", "Initial-01!")
    stored = await auth_repository.get_session_by_token_hash(hash_token(created.token))
    assert stored is not None
    assert stored.token_hash != created.token
    assert created.cookie.http_only is True

def test_seed_file_has_exactly_five_named_users(seed_payload) -> None:
    assert [item["username"] for item in seed_payload] == [f"researcher0{i}" for i in range(1, 6)]
    assert all(len(item["password"]) >= 20 for item in seed_payload)
```

- [ ] **Step 2: Run authentication tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth_service.py backend/tests/test_seed_users.py -q`

Expected: FAIL because auth modules and seed command do not exist.

- [ ] **Step 3: Implement Argon2id password hashing and opaque session tokens**

```python
password_hash = PasswordHash.recommended()

def hash_password(password: str) -> str:
    return password_hash.hash(password)

def verify_password(password: str, encoded: str) -> bool:
    return password_hash.verify(password, encoded)

def new_session_token() -> str:
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Implement login/logout/me, session expiry, CSRF, and stable errors**

Use `survey_session` as an HttpOnly cookie and `survey_csrf` as the double-submit cookie. Require `X-CSRF-Token` plus same-origin validation for authenticated mutation requests. Return `{code, message, details}` through a shared `ApiError` handler. Missing, expired, revoked, or inactive-user sessions return `401 AUTH_SESSION_EXPIRED`; bad credentials return `401 AUTH_INVALID_CREDENTIALS`.

- [ ] **Step 5: Implement exact-five-user seed generation and idempotent database synchronization**

```json
[
  {"username":"researcher01","password":"generated-at-init","locale":"zh-CN"},
  {"username":"researcher02","password":"generated-at-init","locale":"zh-CN"},
  {"username":"researcher03","password":"generated-at-init","locale":"zh-CN"},
  {"username":"researcher04","password":"generated-at-init","locale":"zh-CN"},
  {"username":"researcher05","password":"generated-at-init","locale":"zh-CN"}
]
```

The shell script replaces each example password with an independently generated value, uses `umask 077`, refuses to overwrite an existing seed file, and applies mode `600`. The CLI inserts only missing usernames and never resets existing hashes during startup.

- [ ] **Step 6: Run API tests and verify GREEN**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_auth_service.py backend/tests/test_auth_api.py backend/tests/test_seed_users.py -q`

Expected: PASS, including login, logout, expiry, CSRF, inactive user, and seed idempotency cases.

- [ ] **Step 7: Commit authentication**

```bash
git add .gitignore backend/app backend/tests/test_auth_service.py backend/tests/test_auth_api.py backend/tests/test_seed_users.py deploy/config/seed-users.example.json deploy/scripts/init-config.sh
git commit -m "feat: add seeded user authentication"
```

---

### Task 3: Owned projects, questionnaires, drafts, and immutable versions

**Files:**
- Create: `backend/app/schemas/research.py`
- Create: `backend/app/repositories/research.py`
- Create: `backend/app/services/research_service.py`
- Create: `backend/app/api/projects.py`
- Create: `backend/app/api/questionnaires.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_research_service.py`
- Test: `backend/tests/test_research_api.py`
- Test: `backend/tests/test_user_isolation.py`

**Interfaces:**
- Produces: `ResearchService.create_project(owner_id, payload) -> ProjectView`.
- Produces: `create_questionnaire(owner_id, project_id, payload) -> QuestionnaireView`.
- Produces: `save_draft(owner_id, questionnaire_id, config, expected_revision) -> QuestionnaireView`.
- Produces: `freeze_config(owner_id, questionnaire_id) -> FrozenConfig(questionnaire_version_id, config_version_id, config)`.
- Consumes: authenticated `CurrentUser` from Task 2 and `SurveyConfig` validation from the existing schema.

- [ ] **Step 1: Write failing two-user isolation and immutable-version tests**

```python
@pytest.mark.asyncio
async def test_other_user_cannot_list_or_open_owned_questionnaire(clients) -> None:
    alice, bob = clients
    project = (await alice.post("/api/projects", json={"name":"A","researchGoal":"G","principalName":"A"})).json()
    questionnaire = (await alice.post(f"/api/projects/{project['id']}/questionnaires", json={"mode":"survey","config":valid_config()})).json()
    assert (await bob.get(f"/api/questionnaires/{questionnaire['id']}")).status_code == 404
    assert (await bob.get(f"/api/projects/{project['id']}/questionnaires")).status_code == 404

@pytest.mark.asyncio
async def test_freeze_creates_immutable_version(research_service, alice_id) -> None:
    frozen = await research_service.freeze_config(alice_id, questionnaire_id)
    await research_service.save_draft(alice_id, questionnaire_id, changed_config(), expected_revision=1)
    loaded = await research_service.get_config_version(alice_id, frozen.config_version_id)
    assert loaded.full_snapshot.title == original_config().title
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_research_service.py backend/tests/test_research_api.py backend/tests/test_user_isolation.py -q`

Expected: FAIL because owned research APIs do not exist.

- [ ] **Step 3: Implement ownership-first repository queries**

Every resource query joins through `projects.owner_user_id` and accepts `owner_id` as a required argument. Never implement `get_questionnaire(questionnaire_id)` without owner context. Use `SELECT questionnaires.* FROM questionnaires JOIN projects ON projects.id=questionnaires.project_id WHERE questionnaires.id=:id AND projects.owner_user_id=:owner_id` and return `None` for cross-owner IDs.

- [ ] **Step 4: Implement project/questionnaire APIs and optimistic draft saving**

`PATCH /api/questionnaires/{id}` accepts `{config, expectedRevision}`. The SQL update includes `WHERE draft_revision=:expected_revision`, increments revision, and returns `409 DRAFT_CONFLICT` when no row matches. Project and questionnaire list responses are ordered by `updated_at DESC, id`.

- [ ] **Step 5: Implement content-hashed immutable freezing in one transaction**

```python
canonical = json.dumps(config.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
content_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
```

Reuse an existing questionnaire version only when its questionnaire ID, schema version, and content hash match. Always create or reuse a full config version that points to that questionnaire version. Reject unknown schema versions with `CONFIG_VERSION_UNSUPPORTED`.

- [ ] **Step 6: Run focused and full backend tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_research_service.py backend/tests/test_research_api.py backend/tests/test_user_isolation.py -q`

Expected: PASS with two users isolated, stale drafts rejected, and old versions unchanged.

- [ ] **Step 7: Commit the owned research graph**

```bash
git add backend/app backend/tests/test_research_service.py backend/tests/test_research_api.py backend/tests/test_user_isolation.py
git commit -m "feat: add owned projects and questionnaire versions"
```

---

### Task 4: Durable research rounds and recoverable execution controls

**Files:**
- Modify: `backend/app/schemas/survey.py`
- Create: `backend/app/schemas/rounds.py`
- Create: `backend/app/repositories/rounds.py`
- Create: `backend/app/services/round_executor.py`
- Rewrite: `backend/app/services/run_service.py`
- Rewrite: `backend/app/api/runs.py`
- Delete: `backend/app/api/history.py`
- Delete: `backend/app/repositories/memory.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_round_state_machine.py`
- Test: `backend/tests/test_round_executor.py`
- Test: `backend/tests/test_round_api.py`
- Modify: `backend/tests/test_run_service.py`

**Interfaces:**
- Produces: `RunStatus = queued|running|pausing|paused|completed|completed_with_errors|failed|cancelled`.
- Produces: `RunService.create(owner_id, questionnaire_id, locale)`, `pause`, `resume`, `cancel`, `retry(kind)` and `get`.
- Produces: `RoundExecutor.start(round_id)`, `wait(round_id)`, and `reconcile_interrupted_rounds()`.
- Consumes: `FrozenConfig` from Task 3, existing `SimulationEngine`, analytics, and inference services.

- [ ] **Step 1: Write failing state-transition tests**

```python
@pytest.mark.asyncio
async def test_pause_waits_for_checkpoint_then_resume_completes(round_service) -> None:
    created = await round_service.create(alice_id, questionnaire_id, "zh-CN")
    pausing = await round_service.pause(alice_id, created.id)
    assert pausing.status in {"pausing", "paused"}
    paused = await round_service.wait_for_status(alice_id, created.id, "paused")
    checkpoint_count = paused.progress.answeredQuestions
    await asyncio.sleep(0.02)
    assert (await round_service.get(alice_id, created.id)).progress.answeredQuestions == checkpoint_count
    await round_service.resume(alice_id, created.id)
    assert (await round_service.wait(created.id)).status == "completed"

@pytest.mark.asyncio
async def test_illegal_transition_is_conflict(api_client, completed_round_id) -> None:
    response = await api_client.post(f"/api/rounds/{completed_round_id}/pause")
    assert response.status_code == 409
    assert response.json()["code"] == "INVALID_RUN_TRANSITION"
```

- [ ] **Step 2: Run state tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_round_state_machine.py backend/tests/test_round_executor.py -q`

Expected: FAIL because paused states and the checkpoint executor do not exist.

- [ ] **Step 3: Implement the explicit state machine**

```python
ALLOWED_TRANSITIONS = {
    "queued": {"running", "cancelled", "failed", "paused"},
    "running": {"pausing", "completed", "completed_with_errors", "cancelled", "failed", "paused"},
    "pausing": {"paused", "cancelled", "failed"},
    "paused": {"running", "cancelled"},
    "completed": set(),
    "completed_with_errors": set(),
    "failed": set(),
    "cancelled": set(),
}
```

Enforce transitions in the repository with `row_version` compare-and-swap. Return current status and allowed actions in `INVALID_RUN_TRANSITION.details`.

- [ ] **Step 4: Persist respondents and answer checkpoints transactionally**

For each question, create the interviewer message, generated answer, normalized response, progress counts, analytics-invalidating row version, and lease heartbeat in one transaction. A failed transaction leaves the previous checkpoint untouched. Load snapshots from normalized rows instead of retaining authoritative mutable objects in process memory.

- [ ] **Step 5: Add cooperative pause, cancel, restart reconciliation, and leases**

The executor checks `pause_requested_at` after each committed answer. Reconciliation runs during FastAPI lifespan startup and changes expired `queued/running/pausing` rounds to `paused` with `RUN_INTERRUPTED_BY_RESTART`. Resume acquires a fresh lease before scheduling work.

- [ ] **Step 6: Add per-respondent failure containment and retry-derived rounds**

Catch exceptions around one respondent, persist `round_respondents.status=failed`, continue subsequent respondents, and finish as `completed_with_errors`. `retry(kind=failed)` selects only failed rows; `retry(kind=incomplete)` selects pending/in-progress/cancelled rows. Copy exact `profile_json`, reuse `config_version_id`, set `retry_of_round_id`, and return `422 NO_RETRYABLE_RESPONDENTS` for an empty selection.

- [ ] **Step 7: Replace run/history routes with owned round routes**

Expose the endpoints in the spec under `/api/rounds` and `/api/questionnaires/{id}/rounds`. Delete the memory history write path after all callers use durable round listings. Preserve current API response field naming where it still describes the new snapshot.

- [ ] **Step 8: Run round and regression tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_round_state_machine.py backend/tests/test_round_executor.py backend/tests/test_round_api.py backend/tests/test_run_service.py -q`

Expected: PASS for completion, pause/resume, cancel, restart reconciliation, failure containment, and both retry kinds.

- [ ] **Step 9: Commit durable rounds**

```bash
git add backend/app backend/tests/test_round_state_machine.py backend/tests/test_round_executor.py backend/tests/test_round_api.py backend/tests/test_run_service.py
git commit -m "feat: persist and control research rounds"
```

---

### Task 5: Explicit analysis scope and exception drill-down

**Files:**
- Modify: `backend/app/schemas/analytics.py`
- Modify: `backend/app/services/analytics_service.py`
- Rewrite: `backend/app/api/analytics.py`
- Create: `backend/app/services/exception_service.py`
- Create: `backend/app/api/exceptions.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_analytics_service.py`
- Create: `backend/tests/test_analysis_scope.py`
- Create: `backend/tests/test_exceptions_api.py`

**Interfaces:**
- Produces: `AnalysisScope(populationCount, filteredRespondentCount, validResponseCount, excludedResponseCount, filters, groupBy, label)`.
- Produces: `GroupedQuestionSummary.respondentCount` and `.validResponseCount`.
- Produces: `GET /api/rounds/{id}/exceptions -> ExceptionReport`.
- Consumes: owned round snapshots from Task 4.

- [ ] **Step 1: Write failing count and drill-down tests**

```python
def test_scope_distinguishes_people_from_valid_answers(analytics, snapshot) -> None:
    result = analytics.query(snapshot, question_id="q1", filters={"city":"Hangzhou"}, group_by=[])
    assert result.scope.populationCount == 4
    assert result.scope.filteredRespondentCount == 3
    assert result.scope.validResponseCount == 2
    assert result.scope.excludedResponseCount == 1

@pytest.mark.asyncio
async def test_exception_report_links_reason_to_respondents(client, owned_round) -> None:
    response = await client.get(f"/api/rounds/{owned_round.id}/exceptions")
    assert response.json()["groups"][0]["respondents"][0].keys() >= {
        "respondentId", "completedQuestions", "totalQuestions", "lastValidAnswer"
    }
```

- [ ] **Step 2: Run tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_analysis_scope.py backend/tests/test_exceptions_api.py -q`

Expected: FAIL because scope counts and exception reports are absent.

- [ ] **Step 3: Compute scope counts from unique respondent IDs**

Calculate population before filters, matched respondents after filters, valid responders for the selected question, and the set difference for exclusions. Group summaries use unique respondent IDs and never message/answer row counts. Set `smallSample=true` exactly when `validResponseCount < 30`.

- [ ] **Step 4: Build stable exception groups and evidence rows**

Group by `session.status` plus `termination_code` or `error_code`. For each respondent return profile identity, completed/total questions, last response content, status, reason, and timestamps. Sort groups by count descending then code, respondents by original ordinal.

- [ ] **Step 5: Enforce owned access in analytics and exception endpoints**

Resolve the round through `round_repository.get_for_owner(current_user.id, round_id)` before analysis. A cross-owner ID returns the same `404 RESOURCE_NOT_FOUND` as a missing ID.

- [ ] **Step 6: Run analytics tests and commit**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_analytics_service.py backend/tests/test_analysis_scope.py backend/tests/test_exceptions_api.py -q`

Expected: PASS.

```bash
git add backend/app backend/tests/test_analytics_service.py backend/tests/test_analysis_scope.py backend/tests/test_exceptions_api.py
git commit -m "feat: clarify analysis scope and exceptions"
```

---

### Task 6: Traceable scoped exports

**Files:**
- Create: `backend/app/schemas/exports.py`
- Create: `backend/app/repositories/exports.py`
- Rewrite: `backend/app/services/export_service.py`
- Rewrite: `backend/app/api/exports.py`
- Create: `backend/tests/test_export_service.py`
- Create: `backend/tests/test_export_api.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `ExportRequest(format: json|csv, scope: full|filtered|exceptions, filename, filters)`.
- Produces: `ExportService.generate(owner_id, round_id, request) -> GeneratedExport(content, media_type, filename, record_id)`.
- Produces: `POST/GET /api/rounds/{id}/exports`.
- Consumes: owned rounds, analysis filters, and exception reports from Tasks 4–5.

- [ ] **Step 1: Write failing export scope, filename, record, and isolation tests**

```python
@pytest.mark.asyncio
async def test_filtered_export_records_final_safe_name(client, round_id) -> None:
    response = await client.post(
        f"/api/rounds/{round_id}/exports",
        json={"format":"csv","scope":"filtered","filename":"../city report","filters":{"city":"Hangzhou"}},
    )
    assert response.status_code == 200
    assert 'filename="city report.csv"' in response.headers["content-disposition"]
    record_id = response.headers["x-export-record-id"]
    records = (await client.get(f"/api/rounds/{round_id}/exports")).json()
    assert next(item for item in records if item["id"] == record_id)["status"] == "succeeded"
```

- [ ] **Step 2: Run export tests and verify RED**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_export_service.py backend/tests/test_export_api.py -q`

Expected: FAIL because scoped POST exports and export records are absent.

- [ ] **Step 3: Implement filename sanitation and the three exact scopes**

Strip `/`, `\\`, control characters, leading dots, and a user-provided extension; collapse whitespace; use `research-round-<short-id>` when empty; append `.json` or `.csv`. `full` includes every respondent, `filtered` re-applies validated demographic filters, and `exceptions` includes only terminated/failed respondents. Empty selected sets return `422 EXPORT_SCOPE_EMPTY`.

- [ ] **Step 4: Persist processing/succeeded/failed state without false success**

Create the export row before generation. On success, update it and return bytes with `Content-Disposition`, `Content-Language`, and `X-Export-Record-Id`. On generation exception, update the row to `failed` in a separate transaction and return `EXPORT_GENERATION_FAILED`.

- [ ] **Step 5: Run export and regression tests**

Run: `backend/.venv/bin/python -m pytest backend/tests/test_export_service.py backend/tests/test_export_api.py backend/tests/test_api.py -q`

Expected: PASS for JSON/CSV, all scopes, empty scope, safe names, failed records, and cross-owner access.

- [ ] **Step 6: Commit exports**

```bash
git add backend/app backend/tests/test_export_service.py backend/tests/test_export_api.py backend/tests/test_api.py
git commit -m "feat: add traceable scoped exports"
```

---

### Task 7: Frontend application login and owned project/questionnaire workspace

**Files:**
- Rewrite: `app/login/login-form.tsx`
- Modify: `app/login/login-page-content.tsx`
- Modify: `app/page.tsx`
- Modify: `proxy.ts`
- Create: `components/auth-session-provider.tsx`
- Create: `components/research-resource-selector.tsx`
- Create: `components/create-project-dialog.tsx`
- Create: `components/create-questionnaire-dialog.tsx`
- Create: `lib/csrf.ts`
- Rewrite: `lib/survey-api.ts`
- Rewrite: `lib/survey-contract.ts`
- Modify: `lib/i18n/messages.ts`
- Modify: `tests/survey-api.test.mjs`
- Create: `tests/auth-session.test.mjs`
- Create: `tests/research-resources.test.mjs`
- Modify: `tests/i18n.test.mjs`

**Interfaces:**
- Produces: `apiLogin`, `apiLogout`, `apiMe`, project/questionnaire CRUD and draft save clients.
- Produces: `AuthSessionProvider` with `{user, status, logout}`.
- Produces: selected `projectId`, `questionnaireId`, `draftRevision`, and save status for the dashboard.
- Consumes: Task 2–3 API contracts.

- [ ] **Step 1: Write failing API and session tests**

```javascript
test("mutation requests copy CSRF cookie into the header", async () => {
  globalThis.document = { cookie: "survey_csrf=csrf-123" }
  await api.apiCreateProject("zh-CN", { name: "P", researchGoal: "G", principalName: "R" })
  assert.equal(new Headers(captured.init.headers).get("X-CSRF-Token"), "csrf-123")
})

test("dashboard renders owned project and questionnaire selectors", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /ResearchResourceSelector/)
  assert.match(source, /draftRevision/)
  assert.match(source, /apiSaveQuestionnaireDraft/)
})
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `npm run test:frontend -- tests/auth-session.test.mjs tests/research-resources.test.mjs tests/survey-api.test.mjs`

Expected: FAIL because application session and resource clients are absent.

- [ ] **Step 3: Replace deployment credential login with application login**

Submit JSON to `/survey-api/auth/login`, rely on the HttpOnly session cookie, and route successful login to the validated same-origin `next` path. Keep optional outer deployment auth only when explicitly enabled; it must not be treated as `CurrentUser`.

- [ ] **Step 4: Implement shared request behavior**

All requests set exact `Accept-Language`; JSON mutation requests also set `Content-Type` and `X-CSRF-Token`; fetch uses `credentials: "same-origin"`. Parse `{code,message,details}` into `SurveyApiError`. On `AUTH_SESSION_EXPIRED`, clear client session state and navigate to `/login`.

- [ ] **Step 5: Add project/questionnaire creation and selection**

Show a create-project empty state when the owned list is empty. Show project and questionnaire selectors in the header otherwise. Creation dialogs collect the exact spec fields. Switching resources aborts outstanding template/draft/analytics requests before applying new data.

- [ ] **Step 6: Add debounced optimistic draft persistence**

After 500 ms without edits, call `apiSaveQuestionnaireDraft` with `expectedRevision`. Render `saving`, `savedAt`, or `failed` states. Disable Run while the draft is invalid, saving, conflicted, or failed. A `DRAFT_CONFLICT` reloads the current server draft after explicit user confirmation instead of overwriting it.

- [ ] **Step 7: Run frontend tests, typecheck, and commit**

Run: `npm run test:frontend && npm run typecheck`

Expected: PASS.

```bash
git add app components lib proxy.ts tests
git commit -m "feat: add user-owned research workspace"
```

---

### Task 8: Frontend round controls, scope UI, exceptions, history copy, and exports

**Files:**
- Modify: `app/page.tsx`
- Create: `components/run-control-bar.tsx`
- Create: `components/analysis-scope-summary.tsx`
- Create: `components/exception-drilldown.tsx`
- Create: `components/export-dialog.tsx`
- Create: `components/round-history-dialog.tsx`
- Modify: `components/analytics-panel.tsx`
- Modify: `components/bulk-survey-panel.tsx`
- Modify: `components/chat-simulation-panel.tsx`
- Modify: `lib/survey-api.ts`
- Modify: `lib/survey-contract.ts`
- Modify: `lib/i18n/messages.ts`
- Create: `lib/run-actions.ts`
- Create: `tests/run-actions.test.mjs`
- Create: `tests/analysis-scope-ui.test.mjs`
- Create: `tests/export-dialog.test.mjs`
- Modify: `tests/i18n.test.mjs`

**Interfaces:**
- Produces: `allowedRunActions(status, failedCount, incompleteCount) -> RunAction[]`.
- Produces: mode-aware analysis labels and small-sample warning.
- Produces: export request UI for `full|filtered|exceptions`.
- Consumes: round/analysis/exception/export APIs from Tasks 4–6.

- [ ] **Step 1: Write failing pure action and UI contract tests**

```javascript
test("run actions match terminal and active states", () => {
  assert.deepEqual(allowedRunActions("running", 0, 0), ["pause", "cancel"])
  assert.deepEqual(allowedRunActions("paused", 0, 2), ["resume", "cancel"])
  assert.deepEqual(allowedRunActions("completed_with_errors", 2, 0), ["retry_failed"])
  assert.deepEqual(allowedRunActions("cancelled", 0, 3), ["retry_incomplete"])
})
```

Assert the analytics source renders `populationCount`, `filteredRespondentCount`, `validResponseCount`, `excludedResponseCount`, and mode-specific survey/interview labels. Assert export UI contains the three exact scopes and a filename input.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm run test:frontend -- tests/run-actions.test.mjs tests/analysis-scope-ui.test.mjs tests/export-dialog.test.mjs`

Expected: FAIL because the new controls and scope UI do not exist.

- [ ] **Step 3: Add round polling and mutation controls**

Poll only `queued`, `running`, and `pausing`. Pause/resume/cancel/retry buttons guard duplicate requests and immediately replace the displayed snapshot with the mutation response. Show localized action progress, success, and `SurveyApiError.code` failures.

- [ ] **Step 4: Replace memory-history UI with owned round history**

List rounds for the selected project with round name, questionnaire, mode, config version, status, sample summary, and timestamps. Opening a round renders its immutable config and result. Copy invokes `/rounds/{id}/copy`, selects the returned draft questionnaire, and leaves the source unchanged.

- [ ] **Step 5: Render analysis scope and exception drill-down**

Show 总体/Overall when filters are empty and a readable filter summary otherwise. Always render `N`, filtered `n`, valid `n`, and excluded count next to the selected question. Show the exploratory warning below 30 valid responses. Exception groups open a respondent list and selecting a row focuses that respondent in the result panel.

- [ ] **Step 6: Add scoped export flow and records**

The dialog collects format, scope, current filters for `filtered`, and filename. Disable filtered export when its scope is empty. Download using the server-provided `Content-Disposition` filename, display a success toast with scope/time/filename, show stable error messages, and list previous export records in round history.

- [ ] **Step 7: Fix mode-specific copy throughout results and analytics**

Use questionnaire/answer/completion wording for `survey`; use interview/dialog wording for `interview`. Do not render interview semantics in survey status or analysis headings.

- [ ] **Step 8: Run tests, typecheck, build, and commit**

Run: `npm run test:frontend && npm run typecheck && npm run build`

Expected: PASS; record any existing non-failing Babel warning for final documentation.

```bash
git add app components lib tests
git commit -m "feat: complete P0 research workflows"
```

---

### Task 9: Three-service Docker deployment, persistence, backup, and restore

**Files:**
- Create: `Dockerfile`
- Create: `backend/Dockerfile`
- Create: `backend/docker-entrypoint.sh`
- Create: `compose.yaml`
- Create: `.dockerignore`
- Modify: `package.json`
- Modify: `next.config.mjs`
- Rewrite: `deploy/scripts/start.sh`
- Rewrite: `deploy/scripts/stop.sh`
- Rewrite: `deploy/scripts/status.sh`
- Rewrite: `deploy/scripts/check-prerequisites.sh`
- Create: `deploy/scripts/backup-db.sh`
- Create: `deploy/scripts/restore-db.sh`
- Modify: `deploy/scripts/common.sh`
- Modify: `deploy/config/deploy.env.example`
- Modify: `deploy/tests/deployment-contract.test.mjs`
- Create: `deploy/tests/docker-compose-contract.test.mjs`
- Create: `deploy/tests/persistence-smoke.sh`

**Interfaces:**
- Produces: Compose services `frontend`, `backend`, `db`, optional profile service `cloudflared`, and volume `survey_postgres_data`.
- Produces npm commands `docker:init`, `docker:build`, `docker:up`, `docker:status`, `docker:logs`, `docker:down`, `docker:backup`, `docker:restore`.
- Consumes: Alembic and seed CLI from Tasks 1–2 and health endpoints from backend/frontend.

- [ ] **Step 1: Write failing Docker contract tests before configuration files**

```javascript
test("compose separates frontend backend and persistent db", () => {
  const compose = readFileSync("compose.yaml", "utf8")
  for (const service of ["frontend:", "backend:", "db:"]) assert.match(compose, new RegExp(`^  ${service}`, "m"))
  assert.match(compose, /survey_postgres_data:\s*$/m)
  assert.match(compose, /source:\s*survey_postgres_data/)
  assert.doesNotMatch(compose, /5432:5432/)
})
```

Add assertions that backend waits for healthy db, frontend waits for healthy backend, no source directory is bind-mounted in production, and the cloudflared service is under profile `public`.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `node --test deploy/tests/docker-compose-contract.test.mjs deploy/tests/deployment-contract.test.mjs`

Expected: FAIL because `compose.yaml` and Dockerfiles do not exist.

- [ ] **Step 3: Add multi-stage frontend and backend images**

Set `output: "standalone"` in `next.config.mjs`. The frontend builder runs `npm ci`, `npm run typecheck`, and `npm run build`; the runtime copies `.next/standalone`, `.next/static`, and `public`, then starts `server.js` as a non-root user. The backend image installs locked requirements, copies Alembic/app code, runs as a non-root user, and starts through an entrypoint that performs `alembic upgrade head`, idempotent seed synchronization, then `uvicorn app.main:app --host 0.0.0.0 --port 8000`.

- [ ] **Step 4: Add Compose networking, health checks, secrets, and volume**

Publish frontend only as `127.0.0.1:${LOCAL_PORT:-3000}:3000`. Keep backend and db on the internal network with no host-wide published ports. Pass `DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`; mount `seed-users.json` read-only; use `pg_isready`, backend `/api/health`, and frontend `/survey-api/health` health checks.

- [ ] **Step 5: Rewrite deployment wrappers around Docker Compose**

`deploy:start` initializes config if requested, validates Docker/Compose and private file modes, builds, starts core services, waits for health, and optionally starts the `public` profile. `npm stop` maps to ordinary Compose down without `-v`. Status reports container health, local URL, public URL when available, database volume, and migration revision.

- [ ] **Step 6: Implement safe backup and restore scripts**

Backup runs `pg_dump --format=custom` in the db container and writes a timestamped mode-`600` file under Git-ignored `deploy/backups/`. Restore refuses a missing/empty file, requires an explicit `--confirm` flag, restores only into the configured application database, and prints the exact target before mutation. Neither daily stop nor upgrade invokes restore or volume deletion.

- [ ] **Step 7: Run Docker contract and shell syntax tests**

Run: `node --test deploy/tests/*.test.mjs && bash -n deploy/scripts/*.sh backend/docker-entrypoint.sh && docker compose config --quiet`

Expected: PASS.

- [ ] **Step 8: Build and run the persistence smoke test**

Run: `npm run docker:build && npm run docker:up && bash deploy/tests/persistence-smoke.sh`

The script logs in as user A, creates a project/questionnaire/round, records IDs, verifies user B gets 404, restarts backend, verifies the round persists, executes ordinary down/up, verifies it again, creates a non-empty backup, restores into an isolated test database, and confirms the project count.

- [ ] **Step 9: Commit Docker deployment**

```bash
git add Dockerfile backend/Dockerfile backend/docker-entrypoint.sh compose.yaml .dockerignore package.json next.config.mjs deploy
git commit -m "feat: deploy frontend backend and PostgreSQL with Docker"
```

---

### Task 10: Full verification, browser closure, and living documentation

**Files:**
- Rewrite: `README.md`
- Rewrite: `docs/PROJECT_ITERATION.md`
- Rewrite: `backend/README.md`
- Rewrite: `deploy/README.md`
- Rewrite: `deploy/RUNBOOK.md`
- Rewrite: `deploy/ARCHITECTURE.md`
- Rewrite: `deploy/SECURITY.md`
- Rewrite: `deploy/TROUBLESHOOTING.md`
- Create: `docs/verification/2026-09-05-p0-verification.md`

**Interfaces:**
- Consumes: verified behavior and exact command output from Tasks 1–9.
- Produces: current project facts, Docker/macOS runbook, backup/restore procedure, P0 completion record, remaining limitations, and evidence-linked verification report.

- [ ] **Step 1: Run the complete non-browser test matrix from a clean service state**

Run:

```bash
backend/.venv/bin/python -m pytest backend/tests -q
npm run test:frontend
npm run typecheck
npm run build
node --test deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh backend/docker-entrypoint.sh
docker compose config --quiet
docker compose build
```

Expected: every command exits 0. Record counts, durations, and non-failing warnings in the verification report.

- [ ] **Step 2: Run Docker persistence, isolation, and backup closure**

Run: `npm run docker:up && bash deploy/tests/persistence-smoke.sh`

Expected: five users seeded; cross-user list/direct access isolated; backend restart and ordinary down/up preserve the same IDs; interrupted run returns paused; backup is non-empty and isolated restore succeeds.

- [ ] **Step 3: Run browser flows at five target viewports**

Use Playwright against the Docker frontend and verify 390×844, 768×720, 1024×720, 1280×720, and 1440×720. Cover login, project/questionnaire creation, autosave, run, pause/resume, cancel/retry, history copy, overall/filtered/group analysis, exception drill-down, and three export scopes. At each viewport assert document width/height equal viewport width/height and collect console errors/warnings; expected count is zero.

- [ ] **Step 4: Test all five seeded credentials and explicit logout**

Log in once with each account, verify `/auth/me` identity, verify only that account's projects are listed, log out, and confirm subsequent business API access is `401 AUTH_SESSION_EXPIRED`.

- [ ] **Step 5: Verify optional Quick Tunnel when network permits**

Run the public Compose profile, capture its generated HTTPS URL, verify the application login page, authenticated health, and one owned project request. If network prevents a tunnel, record the exact error and report the local/contract verification only.

- [ ] **Step 6: Update living docs from observed facts**

Set P0-A/P0-B/P0-C and the full P0 stage to completed only when every completion criterion passed. Explain user ownership, five seeded accounts, immutable versions, run controls, PostgreSQL volume semantics, ordinary versus destructive stop, backup/restore, exact Docker commands, remaining Mock boundary, and known warnings. Add a new top iteration record with goal, actual changes, verification, remaining issues, and next step.

- [ ] **Step 7: Cross-check documentation for stale claims**

Run:

```bash
rg -n "MemoryRepository|内存仓储|后端重启后丢失|共享账号|未接入.*数据库|P0-B.*未开始|P0-C.*未开始" README.md docs/PROJECT_ITERATION.md backend/README.md deploy
git diff --check
```

Expected: matches exist only in explicitly labeled historical records or removed-capability explanations; no live-state section contains a stale claim; `git diff --check` is clean.

- [ ] **Step 8: Re-run critical smoke tests after documentation-only edits**

Run: `npm run typecheck && npm run build && backend/.venv/bin/python -m pytest backend/tests -q`

Expected: PASS.

- [ ] **Step 9: Commit final verification and documentation**

```bash
git add README.md docs/PROJECT_ITERATION.md docs/verification/2026-09-05-p0-verification.md backend/README.md deploy
git commit -m "docs: close complete P0 verification loop"
```

- [ ] **Step 10: Inspect final branch state**

Run: `git status --short && git log --oneline -12`

Expected: clean worktree and a traceable commit sequence for database, authentication, research resources, durable rounds, analytics, exports, frontend workflows, Docker deployment, and final docs.
