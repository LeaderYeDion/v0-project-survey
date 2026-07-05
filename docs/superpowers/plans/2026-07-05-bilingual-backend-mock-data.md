# Bilingual Backend Mock Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return complete Chinese or English Mock survey data from the backend, freeze the selected frontend locale at mode confirmation, and isolate all Mock-specific data and behavior behind replaceable interfaces.

**Architecture:** A normalized locale is persisted on every run and history record. Generic API, orchestration, and analytics code depend on protocols, while `backend/app/mocks/` supplies localized templates, labels, random profiles, answers, delays, and termination behavior. The frontend reloads the default template while language selection is open and makes locale state immutable after mode confirmation.

**Tech Stack:** Python 3.14, FastAPI, Pydantic, pytest, Next.js 16, React 19, TypeScript 5.7, Node test runner.

---

## File Structure

- Create `backend/app/locales.py`: locale type and exact-header normalization.
- Create `backend/app/mocks/__init__.py`: public Mock package exports.
- Create `backend/app/mocks/catalog.py`: complete Chinese and English Mock catalogs and template/label provider.
- Create `backend/app/mocks/engine.py`: Mock simulation behavior.
- Create `backend/app/services/simulation_engine.py`: replaceable simulation protocol.
- Create `backend/app/services/template_provider.py`: replaceable template protocol.
- Create `backend/app/services/analysis_labels.py`: replaceable analytics-label protocol.
- Modify `backend/app/schemas/survey.py`: persist locale on run and history contracts.
- Modify `backend/app/api/language.py`: normalize instead of reject request language.
- Modify `backend/app/api/templates.py`, `backend/app/api/runs.py`, `backend/app/main.py`: inject providers and pass normalized locale.
- Modify `backend/app/services/run_service.py`, `backend/app/services/analytics_service.py`, `backend/app/repositories/memory.py`: consume protocols and preserve locale.
- Delete `backend/app/services/mock_engine.py`: remove the old scattered Mock implementation.
- Modify backend tests and add `backend/tests/test_locales.py`, `backend/tests/test_mock_catalog.py`, `backend/tests/test_architecture.py`.
- Modify `lib/survey-contract.ts`: expose persisted run/history locale.
- Create `lib/i18n/locale-lock.ts`: pure immutable-locale transition.
- Modify `components/locale-provider.tsx`, `app/page.tsx`, and `tests/i18n.test.mjs`: lock locale and make template loading race-safe.

### Task 1: Normalize and Persist Backend Locale

**Files:**
- Create: `backend/app/locales.py`
- Create: `backend/tests/test_locales.py`
- Modify: `backend/app/api/language.py`
- Modify: `backend/app/schemas/survey.py`
- Modify: `backend/app/repositories/memory.py`
- Modify: `backend/tests/test_schemas.py`

- [ ] **Step 1: Write failing locale normalization tests**

```python
from app.locales import normalize_locale


def test_only_exact_chinese_header_selects_chinese() -> None:
    assert normalize_locale("zh-CN") == "zh-CN"
    assert normalize_locale("en-US") == "en-US"
    assert normalize_locale(None) == "en-US"
    assert normalize_locale("fr-FR") == "en-US"
    assert normalize_locale("zh-cn") == "en-US"
    assert normalize_locale("zh-CN,zh;q=0.9") == "en-US"
```

- [ ] **Step 2: Run the locale test and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_locales.py -q`

Expected: FAIL because `app.locales` does not exist.

- [ ] **Step 3: Implement locale normalization and HTTP dependency**

```python
# backend/app/locales.py
from typing import Literal

Locale = Literal["zh-CN", "en-US"]


def normalize_locale(accept_language: str | None) -> Locale:
    return "zh-CN" if accept_language == "zh-CN" else "en-US"
```

Update `require_language` to call `normalize_locale`, assign the result to
`request.state.locale`, set `Content-Language`, and never raise for missing or
unknown values.

- [ ] **Step 4: Run the locale test and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_locales.py -q`

Expected: PASS.

- [ ] **Step 5: Write failing schema tests for persisted locale**

Add assertions that `RunSnapshot.empty(..., locale="en-US")` exposes
`snapshot.locale == "en-US"` and that `MemoryRepository.save_history(snapshot)`
copies the same locale.

- [ ] **Step 6: Run the schema/repository tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_schemas.py tests/test_api.py -q`

Expected: FAIL because snapshots and history records do not yet contain locale.

- [ ] **Step 7: Add locale to run and history models**

Add `locale: Locale` to `RunSnapshot` and `SurveyHistoryRecord`, require a
`locale` argument in `RunSnapshot.empty`, and copy `run.locale` in
`MemoryRepository.save_history`.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_locales.py tests/test_schemas.py -q`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/locales.py backend/app/api/language.py backend/app/schemas/survey.py backend/app/repositories/memory.py backend/tests/test_locales.py backend/tests/test_schemas.py
git commit -m "feat: normalize and persist backend locale"
```

### Task 2: Build Complete Bilingual Mock Catalogs

**Files:**
- Create: `backend/app/mocks/__init__.py`
- Create: `backend/app/mocks/catalog.py`
- Create: `backend/tests/test_mock_catalog.py`
- Modify: `backend/tests/test_mock_engine.py`

- [ ] **Step 1: Write failing bilingual catalog tests**

```python
from app.mocks.catalog import MockCatalog


def test_default_templates_have_parallel_contracts() -> None:
    catalog = MockCatalog()
    zh = catalog.default_template("zh-CN")
    en = catalog.default_template("en-US")
    assert zh.title == "用户体验调研"
    assert en.title == "User Experience Survey"
    assert [item.id for item in zh.questions] == [item.id for item in en.questions]
    assert [item.type for item in zh.questions] == [item.type for item in en.questions]
    assert zh.questions[1].options == ["搜索功能", "推荐系统", "个人中心", "社交分享"]
    assert en.questions[1].options == ["Search", "Recommendations", "Profile", "Social sharing"]


def test_catalogs_expose_localized_profile_and_analysis_data() -> None:
    catalog = MockCatalog()
    assert catalog.data("zh-CN").dimension_labels["gender"] == "性别"
    assert catalog.data("en-US").dimension_labels["gender"] == "Gender"
    assert catalog.data("zh-CN").male_names
    assert catalog.data("en-US").male_names
```

- [ ] **Step 2: Run catalog tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_mock_catalog.py -q`

Expected: FAIL because `app.mocks.catalog` does not exist.

- [ ] **Step 3: Implement immutable bilingual catalog**

Create a frozen `MockLocaleData` dataclass containing:

```python
title: str
description: str
respondent_configs: tuple[RespondentConfig, ...]
questions: tuple[SurveyQuestion, ...]
male_names: tuple[str, ...]
female_names: tuple[str, ...]
nicknames: tuple[str, ...]
educations: tuple[str, ...]
marital_statuses: tuple[str, ...]
avatars: tuple[str, ...]
termination_phrases: tuple[str, ...]
dimension_labels: Mapping[str, str]
income_prefix: str
male_gender: str
female_gender: str
any_gender: str
default_occupation: str
default_city: str
default_income: str
age_tags: tuple[str, str, str]
high_consumer_tag: str
value_consumer_tag: str
tech_tag: str
creative_tag: str
business_tag: str
scale_answer_template: str
choice_answer_template: str
text_answer_template: str
respondent_termination_reason: str
low_quality_termination_reason: str
negative_termination_reason: str
```

Populate both locales without fallback between languages. `default_template`
must create a deep Pydantic copy so callers cannot mutate catalog state.

- [ ] **Step 4: Run catalog tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_mock_catalog.py -q`

Expected: PASS.

- [ ] **Step 5: Expand catalog coverage tests**

Assert English data includes natural English names, occupations, cities,
education, marital status, tags, answer templates, termination phrases, all
five questions, and all choice options. Assert the Chinese template retains
the current visible Chinese values.

- [ ] **Step 6: Run catalog tests**

Run: `cd backend && .venv/bin/pytest tests/test_mock_catalog.py -q`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/mocks backend/tests/test_mock_catalog.py
git commit -m "feat: add bilingual backend mock catalogs"
```

### Task 3: Isolate Mock Behavior Behind Generic Interfaces

**Files:**
- Create: `backend/app/services/simulation_engine.py`
- Create: `backend/app/services/template_provider.py`
- Create: `backend/app/services/analysis_labels.py`
- Create: `backend/app/mocks/engine.py`
- Modify: `backend/app/services/run_service.py`
- Modify: `backend/app/services/analytics_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/templates.py`
- Modify: `backend/app/api/runs.py`
- Modify: `backend/app/api/helpers.py`
- Modify: `backend/tests/test_mock_engine.py`
- Modify: `backend/tests/test_run_service.py`
- Modify: `backend/tests/test_analytics_service.py`
- Create: `backend/tests/test_architecture.py`
- Delete: `backend/app/services/mock_engine.py`

- [ ] **Step 1: Write failing English engine tests**

```python
def test_english_engine_generates_english_profile_and_answer() -> None:
    catalog = MockCatalog()
    engine = MockEngine(catalog, random.Random(2), delay_scale=0)
    config = catalog.default_template("en-US")
    respondent = engine.generate_respondents(config.respondentConfigs, "en-US")[0]
    message = engine.generate_answer(respondent, config.questions[2], "en-US")
    assert respondent.gender in {"Male", "Female"}
    assert respondent.education in catalog.data("en-US").educations
    assert message.answerValue is not None
    assert message.answerValue.type == "text"
    assert "From my perspective" in message.content
```

Add deterministic tests for English termination phrases/reasons and retain the
existing Chinese behavior assertions.

- [ ] **Step 2: Run engine tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_mock_engine.py -q`

Expected: FAIL because the new engine and locale-aware methods do not exist.

- [ ] **Step 3: Define generic protocols**

`SimulationEngine` must expose locale-aware respondent/answer/termination
methods plus `wait_before_question()` and `wait_before_answer()`. It must not
expose RNG state. `TemplateProvider.default_template(locale)` and
`AnalysisLabels.dimension_labels(locale)` /
`AnalysisLabels.income_group_label(locale, value)` define the remaining
replaceable boundaries.

- [ ] **Step 4: Move Mock behavior into `app/mocks/engine.py`**

Port random profiles, answers, sentiments, waits, quality checks, and
termination rules. Every user-visible string must come from `MockCatalog`.
Delete `services/mock_engine.py`.

- [ ] **Step 5: Run engine tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_mock_engine.py -q`

Expected: PASS.

- [ ] **Step 6: Write failing service-boundary and locale lifecycle tests**

Add tests proving:

- `RunService.create_run(request, "en-US")` persists English locale;
- running with the English catalog produces English respondents and answers;
- analytics dimension/group labels use `snapshot.locale`;
- `run_service.py`, `analytics_service.py`, and `templates.py` do not import
  `app.mocks`;
- `run_service.py` contains no Chinese string and does not access `.rng`.

- [ ] **Step 7: Run service tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_run_service.py tests/test_analytics_service.py tests/test_architecture.py -q`

Expected: FAIL because services still depend on the old concrete Mock Engine.

- [ ] **Step 8: Inject protocols and propagate locale**

Update:

```python
async def create_run(
    self,
    request: CreateRunRequest,
    locale: Locale,
) -> RunSnapshot:
```

The executor reads `snapshot.locale` for all engine and analytics calls.
`AnalyticsService` receives `AnalysisLabels`; `templates.py` reads the
application template provider; `main.py` is the only production module that
constructs and wires `MockCatalog` and `MockEngine`.

- [ ] **Step 9: Run service tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_run_service.py tests/test_analytics_service.py tests/test_architecture.py -q`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/app backend/tests
git commit -m "refactor: isolate mock backend implementation"
```

### Task 4: Make API Negotiation and Stored Data Immutable

**Files:**
- Modify: `backend/tests/test_api.py`
- Modify: `backend/app/api/analytics.py`
- Modify: `backend/app/api/history.py`
- Modify: `backend/app/api/exports.py`
- Modify: `backend/app/api/runs.py`

- [ ] **Step 1: Write failing API contract tests**

Cover:

```python
missing = await client.get("/api/templates/default")
assert missing.status_code == 200
assert missing.headers["content-language"] == "en-US"
assert missing.json()["title"] == "User Experience Survey"

unknown = await client.get(
    "/api/templates/default",
    headers={"Accept-Language": "fr-FR"},
)
assert unknown.status_code == 200
assert unknown.headers["content-language"] == "en-US"

chinese = await client.get(
    "/api/templates/default",
    headers={"Accept-Language": "zh-CN"},
)
assert chinese.json()["title"] == "用户体验调研"
```

Create an English run, wait for completion, fetch it with `zh-CN`, and assert
its stored `locale` and representative English respondent/dialog fields are
unchanged. Save history, query analytics, and export JSON/CSV; assert they
retain the stored English business data.

- [ ] **Step 2: Run API tests and verify RED**

Run: `cd backend && .venv/bin/pytest tests/test_api.py -q`

Expected: FAIL against the strict language validator and Chinese-only Mock.

- [ ] **Step 3: Pass request locale only at creation boundaries**

Use `request.state.locale` for default-template and create-run calls. Read,
cancel, history, analytics, and export endpoints must not mutate resource
locale. Analytics queries choose labels from `snapshot.locale`.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `cd backend && .venv/bin/pytest tests/test_api.py -q`

Expected: PASS.

- [ ] **Step 5: Run all backend tests**

Run: `cd backend && .venv/bin/pytest -q`

Expected: all backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: serve immutable locale-aware mock runs"
```

### Task 5: Freeze Frontend Locale and Reload Templates Safely

**Files:**
- Create: `lib/i18n/locale-lock.ts`
- Modify: `components/locale-provider.tsx`
- Modify: `app/page.tsx`
- Modify: `lib/survey-contract.ts`
- Modify: `tests/i18n.test.mjs`
- Modify: `tests/survey-api.test.mjs`

- [ ] **Step 1: Write failing pure locale-lock tests**

```javascript
test("locale transition becomes immutable after locking", async () => {
  const { transitionLocale } = await import("../lib/i18n/locale-lock.ts")
  assert.deepEqual(
    transitionLocale({ locale: "zh-CN", locked: false }, { type: "set", locale: "en-US" }),
    { locale: "en-US", locked: false },
  )
  assert.deepEqual(
    transitionLocale({ locale: "en-US", locked: false }, { type: "lock" }),
    { locale: "en-US", locked: true },
  )
  assert.deepEqual(
    transitionLocale({ locale: "en-US", locked: true }, { type: "set", locale: "zh-CN" }),
    { locale: "en-US", locked: true },
  )
})
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `npm run test:frontend`

Expected: FAIL because `locale-lock.ts` and Provider lock APIs do not exist.

- [ ] **Step 3: Implement the locale state transition and Provider API**

Add `isLocaleLocked: boolean` and `lockLocale(): void` to `I18nContextValue`.
Use the pure transition function so `setLocale` is a no-op after locking.
Only successful unlocked changes synchronize document metadata and Cookie.

- [ ] **Step 4: Update dashboard source tests before production code**

Require:

- mode confirmation calls `lockLocale()`;
- the mode chooser contains `LanguageSwitcher`;
- the persistent workspace header does not contain `LanguageSwitcher`;
- mode buttons are disabled until `loadedTemplateLocale === locale`;
- template loading uses `createLatestRequestTracker`;
- a localized template error appears in the chooser.

- [ ] **Step 5: Run dashboard tests and verify RED**

Run: `npm run test:frontend`

Expected: FAIL because the dashboard still has a persistent switcher and
one-time template loading.

- [ ] **Step 6: Implement race-safe template loading and mode lock**

Track:

```typescript
const [loadedTemplateLocale, setLoadedTemplateLocale] = useState<Locale | null>(null)
const [templateError, setTemplateError] = useState(false)
```

On every unlocked locale change, start a latest-request token, clear loaded
locale/error, fetch the template, and accept success/failure only when the
token remains latest. `handleModeSelection` returns unless the loaded locale
equals the current locale, then calls `lockLocale()` and closes the chooser.
Remove only the header switcher; keep the chooser switcher.

- [ ] **Step 7: Update frontend contracts**

Add `locale: Locale` to `RunSnapshot` and `SurveyHistoryRecord` in
`lib/survey-contract.ts`. Existing request methods continue sending the
frozen locale.

- [ ] **Step 8: Run focused frontend verification**

Run: `npm run test:frontend && npm run typecheck`

Expected: all frontend tests pass and TypeScript exits 0.

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx components/locale-provider.tsx lib/i18n/locale-lock.ts lib/survey-contract.ts tests/i18n.test.mjs tests/survey-api.test.mjs
git commit -m "feat: freeze locale after mode selection"
```

### Task 6: Document and Verify the Final Architecture

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md`

- [ ] **Step 1: Document the replacement boundary**

Add a `Mock implementation boundary` section to `backend/README.md` stating
that all Mock data and behavior live in `app/mocks`, `main.py` is the
composition root, and a real backend replaces the three injected protocols
without changing API routers or `RunService`.

Update the first-version status in `docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md`
with checked items for bilingual Mock catalogs, stored run locale, and the
replaceable Mock package boundary.

- [ ] **Step 2: Scan Mock boundaries**

Run:

```bash
rg -n 'MockEngine|default_survey_config|\\.rng|[一-龥]' \
  backend/app/services backend/app/api
```

Expected: no Mock implementation imports, RNG access, old helper, or
Mock-specific Chinese strings in generic service/API modules. Existing
non-Mock Chinese API error messages are allowed and reviewed separately.

- [ ] **Step 3: Verify old implementation is gone**

Run:

```bash
test ! -e backend/app/services/mock_engine.py
rg -n 'services\\.mock_engine' backend app lib tests
```

Expected: file is absent and search returns no imports.

- [ ] **Step 4: Run complete backend suite**

Run: `cd backend && .venv/bin/pytest -q`

Expected: 0 failures.

- [ ] **Step 5: Run complete frontend checks**

Run:

```bash
npm run test:frontend
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 6: Review requirements against the design**

Confirm Chinese parity, English completeness, exact-header fallback, immutable
run/history language, frontend lock, and the single Mock package boundary.

- [ ] **Step 7: Inspect final diff**

Run: `git status --short && git diff --check && git diff --stat HEAD~5`

Expected: only intended source, test, and documentation files are changed;
the user's `.idea/` files remain untouched and untracked.

- [ ] **Step 8: Commit documentation**

```bash
git add backend/README.md docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md
git commit -m "docs: document bilingual mock boundary"
```
