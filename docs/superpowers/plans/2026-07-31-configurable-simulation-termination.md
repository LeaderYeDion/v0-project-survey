# Configurable Simulation Termination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable simulated early termination by default in survey and interview runs while allowing one strict startup setting to restore both existing termination rules.

**Architecture:** Add a boolean capability flag to `MockEngine` and gate its two termination decisions without changing orchestration or API contracts. Parse the environment variable at FastAPI composition time, then carry the same setting through the existing deployment configuration and documentation.

**Tech Stack:** Python 3.14.6, FastAPI, pytest, Bash, Node.js test runner

## Global Constraints

- The single setting is named `SIMULATION_TERMINATION_ENABLED`.
- The default value is `false`.
- Only the exact lowercase literals `true` and `false` are accepted.
- One setting controls both respondent and interviewer termination.
- Run cancellation, API contracts, historical termination states, and frontend behavior remain unchanged.
- Existing random termination algorithms remain unchanged when the setting is `true`.

---

### Task 1: Gate Both Mock Termination Rules

**Files:**
- Modify: `backend/app/mocks/engine.py`
- Modify: `backend/tests/test_mock_engine.py`
- Modify: `backend/tests/test_run_service.py`

**Interfaces:**
- Produces: `MockEngine(..., termination_enabled: bool = False)`
- Preserves: `respondent_should_terminate(dialog) -> bool`
- Preserves: `interviewer_should_terminate(dialog, low_quality) -> bool`

- [ ] **Step 1: Write failing engine tests**

Add a deterministic RNG whose `random()` returns `0.0`, then assert that the
default engine never terminates and an enabled engine still exercises both
existing termination paths:

```python
def test_termination_is_disabled_by_default() -> None:
    engine = MockEngine(CATALOG, random.Random(1), delay_scale=0)
    dialog = [
        DialogMessage(
            id=f"message-{index}",
            role="respondent",
            content="negative",
            timestamp=datetime.now(UTC),
            sentiment="negative",
        )
        for index in range(6)
    ]

    assert engine.respondent_should_terminate(dialog) is False
    assert engine.interviewer_should_terminate(dialog, low_quality=True) is False


def test_termination_can_be_enabled() -> None:
    engine = MockEngine(
        CATALOG,
        AlwaysTerminateRandom(),
        delay_scale=0,
        termination_enabled=True,
    )
    dialog = [
        DialogMessage(
            id=f"message-{index}",
            role="respondent",
            content="negative",
            timestamp=datetime.now(UTC),
            sentiment="negative",
        )
        for index in range(6)
    ]

    assert engine.respondent_should_terminate(dialog) is True
    assert engine.interviewer_should_terminate(dialog, low_quality=True) is True
```

- [ ] **Step 2: Run the engine tests and verify RED**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_mock_engine.py -v
```

Expected: FAIL because `MockEngine` does not accept `termination_enabled`, and
the default engine can still terminate.

- [ ] **Step 3: Implement the minimal engine flag**

Extend the constructor and guard both decisions:

```python
def __init__(
    self,
    catalog: MockCatalog,
    rng: random.Random | None = None,
    delay_scale: float = 1.0,
    termination_enabled: bool = False,
) -> None:
    self._catalog = catalog
    self._rng = rng or random.Random()
    self._delay_scale = delay_scale
    self._termination_enabled = termination_enabled
```

At the start of each termination method:

```python
if not self._termination_enabled:
    return False
```

- [ ] **Step 4: Add the run-level regression**

Parameterize survey and interview modes, reduce the template to one respondent,
and assert every session completes every configured question:

```python
@pytest.mark.parametrize("mode", ["survey", "interview"])
@pytest.mark.asyncio
async def test_disabled_termination_completes_every_question(mode: str) -> None:
    repository = MemoryRepository()
    catalog = MockCatalog()
    config = catalog.default_template("zh-CN", mode).model_copy(deep=True)
    config.respondentConfigs = [config.respondentConfigs[0].model_copy(update={"count": 1})]
    service = RunService(
        repository=repository,
        engine=MockEngine(catalog, random.Random(1), delay_scale=0),
        analytics=AnalyticsService(catalog),
    )

    created = await service.create_run(
        CreateRunRequest(mode=mode, config=config),
        "zh-CN",
    )
    completed = await service.wait(created.id)

    assert completed.progress.completedRespondents == 1
    assert completed.progress.terminatedRespondents == 0
    assert all(
        session.status == "completed"
        and session.completedQuestions == session.totalQuestions
        for session in completed.sessions
    )
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_mock_engine.py tests/test_run_service.py -v
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/mocks/engine.py backend/tests/test_mock_engine.py backend/tests/test_run_service.py
git commit -m "feat: gate simulated early termination"
```

### Task 2: Parse the Startup Setting Strictly

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `simulation_termination_enabled() -> bool`
- Consumes: `SIMULATION_TERMINATION_ENABLED` from `os.environ`
- Passes: `termination_enabled=<parsed bool>` to `MockEngine`

- [ ] **Step 1: Write failing configuration tests**

Add tests using pytest `monkeypatch`:

```python
@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [(None, False), ("false", False), ("true", True)],
)
def test_simulation_termination_setting(
    monkeypatch: pytest.MonkeyPatch,
    raw_value: str | None,
    expected: bool,
) -> None:
    if raw_value is None:
        monkeypatch.delenv("SIMULATION_TERMINATION_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SIMULATION_TERMINATION_ENABLED", raw_value)

    assert simulation_termination_enabled() is expected


def test_simulation_termination_setting_rejects_invalid_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SIMULATION_TERMINATION_ENABLED", "TRUE")

    with pytest.raises(
        RuntimeError,
        match="SIMULATION_TERMINATION_ENABLED must be true or false",
    ):
        simulation_termination_enabled()
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_api.py -v
```

Expected: collection or test failure because
`simulation_termination_enabled` does not exist.

- [ ] **Step 3: Implement strict parsing and composition**

In `backend/app/main.py`, read the environment at call time:

```python
import os


def simulation_termination_enabled() -> bool:
    value = os.environ.get("SIMULATION_TERMINATION_ENABLED", "false")
    if value not in {"true", "false"}:
        raise RuntimeError(
            "SIMULATION_TERMINATION_ENABLED must be true or false"
        )
    return value == "true"
```

Construct the default engine with:

```python
MockEngine(
    mock_catalog,
    termination_enabled=simulation_termination_enabled(),
)
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd backend
.venv/bin/pytest tests/test_api.py tests/test_mock_engine.py tests/test_run_service.py -v
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_api.py
git commit -m "feat: configure simulation termination at startup"
```

### Task 3: Carry the Setting Through Deployment

**Files:**
- Modify: `deploy/config/deploy.env.example`
- Modify: `deploy/scripts/init-config.sh`
- Modify: `deploy/scripts/common.sh`
- Modify: `deploy/tests/deployment-contract.test.mjs`
- Modify: `deploy/README.md`
- Modify: `deploy/RUNBOOK.md`

**Interfaces:**
- Produces: required deployment setting `SIMULATION_TERMINATION_ENABLED`
- Preserves: `load_deploy_env()` exports validated settings to child processes

- [ ] **Step 1: Write the failing deployment contract**

Extend the deployment test with a helper that writes a complete temporary
configuration and invokes the real `load_deploy_env` function:

```javascript
async function loadDeployEnvWith(setting) {
  const tempDir = await mkdtemp(join(tmpdir(), "survey-deploy-env-"))
  const envFile = join(tempDir, "deploy.env")
  await writeFile(
    envFile,
    [
      "LOCAL_HOST=127.0.0.1",
      "LOCAL_PORT=3000",
      "BACKEND_HOST=127.0.0.1",
      "BACKEND_PORT=8000",
      "SURVEY_BACKEND_URL=http://127.0.0.1:8000",
      "DEPLOY_AUTH_ENABLED=true",
      "DEPLOY_USERNAME=survey",
      "DEPLOY_PASSWORD=0123456789abcdef0123456789abcdef",
      `SIMULATION_TERMINATION_ENABLED=${setting}`,
      "",
    ].join("\n"),
  )
  return execFileAsync("bash", [
    "-c",
    'source deploy/scripts/common.sh; ENV_FILE="$1"; load_deploy_env; printf "%s" "$SIMULATION_TERMINATION_ENABLED"',
    "load-deploy-env",
    envFile,
  ], { cwd: projectRoot })
}

test("loads valid simulation termination settings", async () => {
  assert.equal((await loadDeployEnvWith("false")).stdout, "false")
  assert.equal((await loadDeployEnvWith("true")).stdout, "true")
})

test("rejects invalid simulation termination settings", async () => {
  await assert.rejects(
    loadDeployEnvWith("TRUE"),
    /SIMULATION_TERMINATION_ENABLED must be true or false/,
  )
})
```

Extend the existing generated/example configuration contract to require the
new setting in `init-config.sh` and `deploy.env.example`. Documentation is
reviewed directly rather than tested as source text.

- [ ] **Step 2: Run the deployment test and verify RED**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
```

Expected: FAIL because the real configuration loader does not require or
validate the new setting.

- [ ] **Step 3: Add and validate the deployment setting**

Add this line to both generated and example configurations:

```bash
SIMULATION_TERMINATION_ENABLED=false
```

Add the variable to the required-name loop in `load_deploy_env`, then validate:

```bash
[[ "$SIMULATION_TERMINATION_ENABLED" == "true" ||
  "$SIMULATION_TERMINATION_ENABLED" == "false" ]] ||
  die "SIMULATION_TERMINATION_ENABLED must be true or false"
```

- [ ] **Step 4: Document operation**

In `deploy/README.md`, explain that the default `false` guarantees complete
answering in both modes and `true` restores both random termination rules.

In `deploy/RUNBOOK.md`, add the setting to the generated configuration example
and state that changing it requires `npm stop` followed by
`npm run deploy:start`.

- [ ] **Step 5: Run deployment tests and verify GREEN**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
bash -n deploy/scripts/common.sh deploy/scripts/init-config.sh deploy/scripts/start.sh
```

Expected: tests PASS and Bash syntax checking exits 0.

- [ ] **Step 6: Commit**

```bash
git add deploy/config/deploy.env.example deploy/scripts/init-config.sh deploy/scripts/common.sh deploy/tests/deployment-contract.test.mjs deploy/README.md deploy/RUNBOOK.md
git commit -m "docs: configure simulation termination in deployment"
```

### Task 4: Full Verification

**Files:**
- Verify only; no planned production changes

**Interfaces:**
- Verifies all prior task outputs together.

- [ ] **Step 1: Run the complete backend suite**

Run:

```bash
cd backend
.venv/bin/pytest -v
```

Expected: all backend tests PASS.

- [ ] **Step 2: Run the complete frontend and deployment suite**

Run:

```bash
npm run test:frontend
node --test deploy/tests/*.test.mjs
```

Expected: all frontend and deployment Node.js tests PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Review final scope**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: only the engine, startup composition, deployment configuration,
documentation, tests, design, and plan are changed.
