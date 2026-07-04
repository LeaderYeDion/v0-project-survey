# Bilingual Survey Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent Chinese/English interface switch across login and the survey workspace, while sending the selected language to every backend request without translating backend-returned content.

**Architecture:** A project-local typed message catalog and React locale provider own UI language. The root layout resolves Cookie first and browser `Accept-Language` second, while every API call explicitly receives the selected locale and sends it as `Accept-Language`; FastAPI validates and echoes the language but leaves Mock bodies unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner, FastAPI, Pydantic/pytest.

---

### Task 1: Implement locale parsing and typed catalogs

**Files:**
- Create: `lib/i18n/locale.ts`
- Create: `lib/i18n/messages.ts`
- Create: `tests/i18n.test.mjs`

- [ ] **Step 1: Write failing locale tests**

Add tests that import `lib/i18n/locale.ts` and assert:

```js
assert.equal(normalizeLocale("zh-CN"), "zh-CN")
assert.equal(normalizeLocale("zh-TW,zh;q=0.9"), "zh-CN")
assert.equal(normalizeLocale("en-GB,en;q=0.9"), "en-US")
assert.equal(resolveLocale("en-US", "zh-CN"), "en-US")
assert.equal(resolveLocale("invalid", "zh-CN"), "zh-CN")
assert.equal(resolveLocale(undefined, "fr-FR"), "en-US")
```

Also assert `Object.keys(messages["zh-CN"])` and all nested keys/functions match `messages["en-US"]`.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/i18n.test.mjs
```

Expected: FAIL because `lib/i18n/locale.ts` and `messages.ts` do not exist.

- [ ] **Step 3: Implement locale helpers**

Use this public contract:

```ts
export const supportedLocales = ["zh-CN", "en-US"] as const
export type Locale = (typeof supportedLocales)[number]
export const LOCALE_COOKIE = "survey_locale"

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US"
}

export function normalizeLocale(value?: string | null): Locale {
  return value?.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"
}

export function resolveLocale(
  cookieValue?: string | null,
  acceptLanguage?: string | null,
): Locale {
  return isLocale(cookieValue)
    ? cookieValue
    : normalizeLocale(acceptLanguage)
}
```

Add helpers for locale-aware date, integer and percentage display using `Intl`.

- [ ] **Step 4: Implement the complete typed catalog**

Create `messages` with these top-level sections:

```ts
{
  common,
  metadata,
  auth,
  dashboard,
  config,
  interview,
  survey,
  analytics,
  errors,
}
```

Every section must contain the fixed text currently found in:

- `app/layout.tsx`
- `app/login/page.tsx`
- `app/login/login-form.tsx`
- `app/page.tsx`
- `components/survey-config-panel.tsx`
- `components/chat-simulation-panel.tsx`
- `components/bulk-survey-panel.tsx`
- `components/analytics-panel.tsx`

Use functions for dynamic sentences:

```ts
respondentSummary: (total: number, completed: number) => string
responsePosition: (current: number, total: number) => string
filteredRespondents: (filtered: number, total: number) => string
groupCount: (count: number) => string
questionProgress: (completed: number, total: number | string) => string
```

Define a recursive `MessageShape` type so English must have the same keys and function arguments as Chinese, while string values may differ.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
node --test tests/i18n.test.mjs
npm run typecheck
```

Expected: locale and catalog tests pass; TypeScript reports no catalog mismatch.

Commit:

```bash
git add lib/i18n tests/i18n.test.mjs
git commit -m "feat: add typed Chinese and English catalogs"
```

### Task 2: Add server locale resolution, Provider and switcher

**Files:**
- Create: `lib/i18n/server.ts`
- Create: `components/locale-provider.tsx`
- Create: `components/language-switcher.tsx`
- Modify: `app/layout.tsx`
- Modify: `tests/i18n.test.mjs`

- [ ] **Step 1: Write failing structure tests**

Assert that:

- root layout awaits both `cookies()` and `headers()`;
- `<html lang={locale}>` is used;
- `LocaleProvider` receives `initialLocale`;
- `LanguageSwitcher` exposes both `中文` and `English`;
- changing locale writes `survey_locale` with `Path=/`, `SameSite=Lax`, and a one-year max age.

Run:

```bash
node --test tests/i18n.test.mjs
```

Expected: FAIL because Provider, switcher and server resolution are absent.

- [ ] **Step 2: Implement server resolution**

Create:

```ts
export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ])
  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  )
}
```

- [ ] **Step 3: Implement Provider**

Expose:

```ts
interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  messages: MessageCatalog
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: React.ReactNode
}): JSX.Element

export function useI18n(): I18nContextValue
```

`setLocale` must synchronously update state, `document.documentElement.lang`, and:

```ts
document.cookie =
  `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
```

- [ ] **Step 4: Implement switcher and layout**

The switcher renders an accessible two-option control with `aria-label` from the catalog. Root layout becomes async, obtains locale, renders `<html lang={locale}>`, wraps children in `LocaleProvider`, and implements localized `generateMetadata()`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/i18n.test.mjs
npm run typecheck
npm run build
```

Commit:

```bash
git add app/layout.tsx components/locale-provider.tsx components/language-switcher.tsx lib/i18n tests/i18n.test.mjs
git commit -m "feat: add persistent locale provider and switcher"
```

### Task 3: Send and validate the language protocol

**Files:**
- Modify: `lib/survey-api.ts`
- Create: `backend/app/api/language.py`
- Modify: `backend/app/api/templates.py`
- Modify: `backend/app/api/runs.py`
- Modify: `backend/app/api/history.py`
- Modify: `backend/app/api/analytics.py`
- Modify: `backend/app/api/exports.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`
- Modify: `backend/tests/test_health.py`
- Modify: `tests/survey-api.test.mjs`

- [ ] **Step 1: Write failing frontend protocol tests**

Require every exported Survey API method to accept `locale: Locale`, and require both JSON and Blob requests to contain:

```ts
"Accept-Language": locale
```

Include default template, create/fetch/cancel run, save/list/get history, both analytics queries and export.

- [ ] **Step 2: Write failing backend protocol tests**

For a representative business endpoint assert:

```py
assert client.get("/api/templates/default").status_code == 400

response = client.get(
    "/api/templates/default",
    headers={"Accept-Language": "en-US"},
)
assert response.status_code == 200
assert response.headers["Content-Language"] == "en-US"
assert response.json()["title"] == default_survey_config().title

response = client.get(
    "/api/templates/default",
    headers={"Accept-Language": "fr-FR"},
)
assert response.status_code == 400
assert response.json()["detail"]["code"] == "LANGUAGE_NOT_SUPPORTED"
```

Assert `/api/health` still succeeds without the header and returns `Content-Language: zh-CN`.

- [ ] **Step 3: Verify RED**

Run:

```bash
node --test tests/survey-api.test.mjs
backend/.venv/bin/python -m pytest backend/tests/test_api.py backend/tests/test_health.py -q
```

Expected: frontend header assertions and backend header contract fail.

- [ ] **Step 4: Implement FastAPI language dependency**

Create:

```py
Locale = Literal["zh-CN", "en-US"]

async def require_language(
    request: Request,
    response: Response,
    accept_language: Annotated[
        str | None,
        Header(alias="Accept-Language"),
    ] = None,
) -> Locale:
    if accept_language not in {"zh-CN", "en-US"}:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "LANGUAGE_NOT_SUPPORTED",
                "message": "Accept-Language must be zh-CN or en-US",
            },
        )
    request.state.locale = accept_language
    response.headers["Content-Language"] = accept_language
    return accept_language
```

Attach `Depends(require_language)` to all business routers. Export responses explicitly copy `request.state.locale` into `Content-Language`. Health sets `Content-Language: zh-CN` without requiring a header.

- [ ] **Step 5: Make Survey API locale explicit**

Use locale as the first argument consistently:

```ts
apiFetchDefaultTemplate(locale, signal)
apiCreateRun(locale, mode, config)
apiFetchRun(locale, runId, signal)
apiCancelRun(locale, runId)
apiSaveRunToHistory(locale, runId)
apiFetchSurveyHistory(locale)
apiFetchSurveyHistoryById(locale, id)
apiQueryRunAnalytics(locale, runId, query)
apiQueryHistoryAnalytics(locale, historyId, query)
apiExportSurveyResults(locale, source, format)
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test tests/survey-api.test.mjs
backend/.venv/bin/python -m pytest backend/tests -q
npm run typecheck
```

Commit:

```bash
git add lib/survey-api.ts tests/survey-api.test.mjs backend/app backend/tests
git commit -m "feat: add locale contract to survey APIs"
```

### Task 4: Localize login and login errors

**Files:**
- Create: `app/login/login-page-content.tsx`
- Modify: `app/login/page.tsx`
- Modify: `app/login/login-form.tsx`
- Modify: `app/api/auth/login/route.ts`
- Modify: `deploy/tests/basic-auth.test.mjs`
- Modify: `tests/i18n.test.mjs`

- [ ] **Step 1: Write failing login tests**

Add tests that call the route with invalid credentials and:

```js
headers: { "Accept-Language": "en-US" }
```

Expect `"The username or password is incorrect."`; with `zh-CN`, expect the existing Chinese message. Assert `LoginForm` sends `Accept-Language: locale` and no fixed Chinese UI strings remain in login components.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test deploy/tests/basic-auth.test.mjs tests/i18n.test.mjs
```

- [ ] **Step 3: Implement localized login**

`LoginPage` keeps server-side `next` sanitization and renders:

```tsx
return <LoginPageContent nextPath={nextPath} />
```

`LoginPageContent` uses `useI18n()`, renders the top-right switcher and all login copy. `LoginForm` uses catalog text and sends:

```ts
headers: {
  "Content-Type": "application/json",
  "Accept-Language": locale,
}
```

The route normalizes only `zh-CN` and `en-US`, defaults missing headers to Chinese, and selects error strings from a two-entry server map.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test deploy/tests/basic-auth.test.mjs tests/i18n.test.mjs
npm run typecheck
```

Commit:

```bash
git add app/login app/api/auth/login/route.ts deploy/tests/basic-auth.test.mjs tests/i18n.test.mjs
git commit -m "feat: localize deployment login"
```

### Task 5: Localize dashboard orchestration and configuration

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/survey-config-panel.tsx`
- Modify: `tests/i18n.test.mjs`
- Modify: `tests/survey-api.test.mjs`

- [ ] **Step 1: Write failing boundary tests**

Require `app/page.tsx` and `survey-config-panel.tsx` to use `useI18n()` and `LanguageSwitcher`. Assert API calls pass `locale`.

Reject fixed Han-script UI literals after allowing only protocol/domain literals:

```js
const allowedDomainValues = ["不限"]
```

Comments are stripped before scanning.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/i18n.test.mjs tests/survey-api.test.mjs
```

- [ ] **Step 3: Localize dashboard**

Replace mode selection, workspace navigation, mobile sheet headings, running/history/idle state, resize ARIA labels and all header copy with catalog values. Add `LanguageSwitcher` to the upper-right header without changing the three-column layout.

Pass locale to template, run, polling and export API calls. Include locale in polling effect dependencies so later polls use the newly selected language without recreating the run.

- [ ] **Step 4: Localize configuration panel**

Replace labels, placeholders, question types, JSON errors, add/delete controls, respondent summary and start/running buttons. Keep actual config values and backend-returned question content untouched.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/i18n.test.mjs tests/survey-api.test.mjs
npm run typecheck
```

Commit:

```bash
git add app/page.tsx components/survey-config-panel.tsx tests
git commit -m "feat: localize dashboard and survey configuration"
```

### Task 6: Localize interview and questionnaire result panels

**Files:**
- Modify: `components/chat-simulation-panel.tsx`
- Modify: `components/bulk-survey-panel.tsx`
- Modify: `tests/i18n.test.mjs`

- [ ] **Step 1: Extend failing boundary tests**

Require both panels to use `useI18n()` and reject fixed Han-script UI text. Allow only text that is explicitly backend/domain data; component labels, statuses, chart summaries and empty states must fail the scan.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/i18n.test.mjs
```

- [ ] **Step 3: Localize interview panel**

Translate respondent/conversation navigation, statuses, sentiments, empty states, interviewer role, age/unit display, question progress, message totals and ARIA labels. Keep names, cities, genders and message content as returned.

- [ ] **Step 4: Localize questionnaire panel**

Translate overview cards, completion text, question type labels, statistics names, answer units, response navigation, status labels and empty states. Keep question text, option labels and answer values unchanged.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/i18n.test.mjs
npm run typecheck
```

Commit:

```bash
git add components/chat-simulation-panel.tsx components/bulk-survey-panel.tsx tests/i18n.test.mjs
git commit -m "feat: localize survey result panels"
```

### Task 7: Localize analytics and history

**Files:**
- Modify: `components/analytics-panel.tsx`
- Modify: `tests/i18n.test.mjs`
- Modify: `tests/survey-api.test.mjs`

- [ ] **Step 1: Extend failing analytics tests**

Require analytics to use `useI18n()`, pass locale to all history and analytics API calls, and contain no fixed Han-script UI labels except backend protocol checks such as `"收入:"`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/i18n.test.mjs tests/survey-api.test.mjs
```

- [ ] **Step 3: Localize analytics**

Translate overview/question/demographic tabs, status and sentiment legends, history dialog, save/export controls, filters, grouping actions, chart axes, tooltips, response counts, progress footer and empty states.

Use locale-aware `Intl.DateTimeFormat` for history timestamps. Keep `tagName`, question text, response distribution keys and other backend-returned values untouched.

Pass locale to save/list history and both analytics query APIs; include locale in effects and callbacks so a language change affects subsequent requests.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test tests/i18n.test.mjs tests/survey-api.test.mjs
npm run typecheck
```

Commit:

```bash
git add components/analytics-panel.tsx tests
git commit -m "feat: localize analytics and history"
```

### Task 8: Update deploy health requests and documentation

**Files:**
- Modify: `deploy/scripts/start.sh`
- Modify: `deploy/RUNBOOK.md`
- Modify: `deploy/TROUBLESHOOTING.md`
- Modify: `docs/PROJECT_ITERATION.md`
- Modify: `deploy/tests/deployment-contract.test.mjs`

- [ ] **Step 1: Write failing deployment contract assertion**

Require direct and proxied backend health checks in `start.sh` to send:

```bash
Accept-Language: zh-CN
```

Even though health permits omission, deployment probes should exercise the language contract.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
```

- [ ] **Step 3: Update deployment and project docs**

Add the header to curl configuration and direct health curl. Document supported languages, language persistence, request header behavior and the rule that backend-returned content is not translated.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test deploy/tests/deployment-contract.test.mjs
bash -n deploy/scripts/*.sh
```

Commit:

```bash
git add deploy docs/PROJECT_ITERATION.md
git commit -m "docs: document bilingual request behavior"
```

### Task 9: Browser and full regression verification

**Files:**
- Modify only if verification reveals a tested defect.

- [ ] **Step 1: Run all automated checks**

```bash
backend/.venv/bin/python -m pytest backend/tests -q
node --test tests/*.test.mjs deploy/tests/*.test.mjs
npm run typecheck
npm run build
bash -n deploy/scripts/*.sh
git diff --check
```

Expected: all tests, types, build and syntax checks pass.

- [ ] **Step 2: Run browser regression in Chinese**

Start FastAPI and Next.js. Emulate `zh-CN`, clear `survey_locale`, and verify login or workspace begins in Chinese. Confirm all survey requests contain `Accept-Language: zh-CN`.

- [ ] **Step 3: Run browser regression in English**

Emulate `en-US`, clear the locale Cookie, and verify:

- login page, invalid-login error and workspace UI are English;
- language remains English after navigation and refresh;
- config, questionnaire, interview, analytics and history fixed labels are English;
- backend-returned Chinese default questions and responses remain Chinese;
- all Survey API and login requests contain `Accept-Language: en-US`.

- [ ] **Step 4: Verify live language switching**

Create a run, record its ID and response count, switch language, and verify the same run ID/data remain while fixed UI text changes immediately.

- [ ] **Step 5: Audit remaining Chinese literals**

Run:

```bash
rg -n '[一-龥]' app components lib \
  --glob '*.{ts,tsx,mjs}'
```

Classify every remaining match as catalog text, backend/domain protocol data, user/backend content handling, or comment. Remove any remaining fixed UI literal.

- [ ] **Step 6: Final commit if browser verification required fixes**

```bash
git add app components lib backend deploy tests docs
git commit -m "fix: complete bilingual interface coverage"
```
