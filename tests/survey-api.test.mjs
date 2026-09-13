import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { messages } from "../lib/i18n/messages.ts"

async function loadSurveyApi() {
  const source = readFileSync("lib/survey-api.ts", "utf8")
    .replace('export * from "./survey-contract"', "")
    .replace(
      /import \{ readCsrfToken \} from "\.\/csrf"\s*/,
      `const readCsrfToken = () => {
        const match = globalThis.document?.cookie
          ?.split(";")
          .map(value => value.trim())
          .find(value => value.startsWith("survey_csrf="))
        return match ? decodeURIComponent(match.slice("survey_csrf=".length)) : null
      }\n`,
    )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  )
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { "Content-Type": "application/json" },
  })
}

test("CSRF_INVALID errors resolve to localized feedback without expiring the app identity", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  let expiryCount = 0
  const unsubscribe = api.onAuthSessionExpired(() => { expiryCount += 1 })
  globalThis.fetch = async () => jsonResponse({ code: "CSRF_INVALID", message: "diagnostic fallback", details: null }, { status: 403 })
  try {
    for (const locale of ["en-US", "zh-CN"]) {
      await assert.rejects(api.apiLogout(locale), error => {
        assert.equal(error.code, "CSRF_INVALID")
        const localized = messages[locale].apiErrors[error.code]
        assert.equal(typeof localized, "string")
        assert.notEqual(localized, error.message)
        return true
      })
    }
    assert.equal(expiryCount, 0)
  } finally { unsubscribe(); globalThis.fetch = originalFetch }
})

test("expired deployment access returns the browser to the login boundary", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  let expiryCount = 0
  const unsubscribe = api.onAuthSessionExpired(() => { expiryCount += 1 })
  globalThis.fetch = async () => jsonResponse({ code: "DEPLOY_AUTH_REQUIRED", message: "Deployment access required", details: null }, { status: 401 })
  try {
    await assert.rejects(api.apiListProjects("en-US"), { code: "DEPLOY_AUTH_REQUIRED" })
    assert.equal(expiryCount, 1)
  } finally { unsubscribe(); globalThis.fetch = originalFetch }
})

test("an aborted old auth failure cannot expire a newer application session", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  let expiryCount = 0, finish
  const unsubscribe = api.onAuthSessionExpired(() => { expiryCount += 1 })
  globalThis.fetch = () => new Promise(resolve => { finish = resolve })
  try {
    const pending = api.apiMe("en-US", controller.signal)
    controller.abort()
    finish(jsonResponse({ code: "AUTH_SESSION_EXPIRED", message: "Old session", details: null }, { status: 401 }))
    await assert.rejects(pending, { name: "AbortError" })
    assert.equal(expiryCount, 0)
  } finally { unsubscribe(); globalThis.fetch = originalFetch }
})

test("survey API uses the same-origin backend path", () => {
  const source = readFileSync("lib/survey-api.ts", "utf8")
  assert.ok(source.includes('const API_BASE = "/survey-api"'))
  assert.doesNotMatch(source, /mock-survey-service/)
})

test("all requests use exact locale and same-origin credentials", async () => {
  const api = await loadSurveyApi()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return jsonResponse({})
  }

  try {
    await api.apiMe("en-US")
    await api.apiListProjects("en-US")
    await api.apiListQuestionnaires("en-US", "project-1")
    await api.apiGetQuestionnaire("en-US", "questionnaire-1")
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 4)
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("Accept-Language"), "en-US")
    assert.equal(new Headers(init.headers).get("Content-Type"), null)
    assert.equal(init.credentials, "same-origin")
  }
})

test("mutation requests copy CSRF cookie into the header", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  let captured
  globalThis.document = { cookie: "other=x; survey_csrf=csrf-123%2Bsafe" }
  globalThis.fetch = async (url, init = {}) => {
    captured = { url, init }
    return jsonResponse({ id: "project-1" }, { status: 201 })
  }

  try {
    await api.apiCreateProject("zh-CN", {
      name: "P",
      researchGoal: "G",
      principalName: "R",
    })
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
  }

  assert.equal(captured.url, "/survey-api/projects")
  assert.equal(captured.init.credentials, "same-origin")
  assert.equal(new Headers(captured.init.headers).get("X-CSRF-Token"), "csrf-123+safe")
  assert.equal(new Headers(captured.init.headers).get("Content-Type"), "application/json")
  assert.deepEqual(JSON.parse(captured.init.body), {
    name: "P",
    researchGoal: "G",
    principalName: "R",
  })
})

test("auth and owned resource clients use the backend contracts", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const calls = []
  globalThis.document = { cookie: "survey_csrf=csrf" }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return jsonResponse({}, { status: url.endsWith("/logout") ? 204 : 200 })
  }

  const config = { title: "T", questions: [], respondentConfigs: [] }
  try {
    await api.apiLogin("en-US", { username: "researcher01", password: "secret" })
    await api.apiLogout("en-US")
    await api.apiCreateQuestionnaire("en-US", "project-1", {
      mode: "survey",
      config,
      schemaVersion: 1,
    })
    await api.apiSaveQuestionnaireDraft("en-US", "questionnaire-1", {
      config,
      expectedRevision: 7,
    })
    await api.apiCreateRound("en-US", "questionnaire-1")
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
  }

  assert.deepEqual(
    calls.map(call => [call.url, call.init.method]),
    [
      ["/survey-api/auth/login", "POST"],
      ["/survey-api/auth/logout", "POST"],
      ["/survey-api/projects/project-1/questionnaires", "POST"],
      ["/survey-api/questionnaires/questionnaire-1", "PATCH"],
      ["/survey-api/questionnaires/questionnaire-1/rounds", "POST"],
    ],
  )
  assert.deepEqual(JSON.parse(calls[3].init.body), {
    config,
    expectedRevision: 7,
  })
})

test("round workflow clients use owner-scoped routes and exact retry payloads", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  const calls = []
  globalThis.document = { cookie: "survey_csrf=csrf" }
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return jsonResponse({})
  }

  try {
    await api.apiListProjectRounds("en-US", "project-1")
    await api.apiFetchRound("en-US", "round-1")
    await api.apiPauseRound("en-US", "round-1")
    await api.apiResumeRound("en-US", "round-1")
    await api.apiCancelRound("en-US", "round-1")
    await api.apiRetryRound("en-US", "round-1", "failed")
    await api.apiCopyRound("en-US", "round-1")
    await api.apiFetchRoundExceptions("en-US", "round-1")
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
  }

  assert.deepEqual(
    calls.map(call => [call.url, call.init.method]),
    [
      ["/survey-api/projects/project-1/rounds", undefined],
      ["/survey-api/rounds/round-1", undefined],
      ["/survey-api/rounds/round-1/pause", "POST"],
      ["/survey-api/rounds/round-1/resume", "POST"],
      ["/survey-api/rounds/round-1/cancel", "POST"],
      ["/survey-api/rounds/round-1/retry", "POST"],
      ["/survey-api/rounds/round-1/copy", "POST"],
      ["/survey-api/rounds/round-1/exceptions", undefined],
    ],
  )
  assert.deepEqual(JSON.parse(calls[5].init.body), { kind: "failed" })
})

test("stable API errors preserve code, message, details, and status", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    jsonResponse(
      {
        code: "DRAFT_CONFLICT",
        message: "Draft revision conflict",
        details: { expectedRevision: 2, actualRevision: 3 },
      },
      { status: 409 },
    )

  try {
    await assert.rejects(
      api.apiGetQuestionnaire("en-US", "questionnaire-1"),
      error => {
        assert.ok(error instanceof api.SurveyApiError)
        assert.equal(error.code, "DRAFT_CONFLICT")
        assert.equal(error.message, "Draft revision conflict")
        assert.deepEqual(error.details, {
          expectedRevision: 2,
          actualRevision: 3,
        })
        assert.equal(error.status, 409)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("session expiry notifies the application session boundary", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  let expiryCount = 0
  const unsubscribe = api.onAuthSessionExpired(() => {
    expiryCount += 1
  })
  globalThis.fetch = async () =>
    jsonResponse(
      { code: "AUTH_SESSION_EXPIRED", message: "Session expired", details: null },
      { status: 401 },
    )

  try {
    await assert.rejects(api.apiListProjects("zh-CN"), {
      code: "AUTH_SESSION_EXPIRED",
    })
  } finally {
    unsubscribe()
    globalThis.fetch = originalFetch
  }
  assert.equal(expiryCount, 1)
})

test("outstanding requests can be aborted before a resource switch", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  let observedSignal
  globalThis.fetch = async (_url, init = {}) => {
    observedSignal = init.signal
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      )
    })
  }

  try {
    const pending = api.apiGetQuestionnaire("en-US", "questionnaire-1")
    api.abortOutstandingSurveyRequests()
    await assert.rejects(pending, { name: "AbortError" })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(observedSignal.aborted, true)
})

test("dashboard delegates orchestration to owned questionnaire and round APIs", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  for (const forbidden of [
    "askQuestion",
    "shouldInterviewerTerminate",
    "analyzeSentiment",
    "apiCreateRun",
    "apiFetchSurveyHistory",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden))
  }
  assert.match(source, /apiCreateRound/)
  assert.match(source, /apiFetchRound/)
})

test("Next rewrites survey API requests", () => {
  const source = readFileSync("next.config.mjs", "utf8")
  assert.ok(source.includes('source: "/survey-api/:path*"'))
  assert.match(source, /SURVEY_BACKEND_URL/)
})
