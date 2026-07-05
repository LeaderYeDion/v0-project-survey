import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

async function loadSurveyApi() {
  const source = readFileSync("lib/survey-api.ts", "utf8").replace(
    'export * from "./survey-contract"',
    "",
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
}

async function loadSurveyApiWithPrivateRequest() {
  const source = readFileSync("lib/survey-api.ts", "utf8")
    .replace('export * from "./survey-contract"', "")
    .concat("\nexport { request as __request }\n")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
}

test("survey API uses the same-origin backend path", () => {
  const source = readFileSync("lib/survey-api.ts", "utf8")
  assert.ok(source.includes('const API_BASE = "/survey-api"'))
  assert.doesNotMatch(source, /mock-survey-service/)
})

test("every survey API request sends the required locale", async () => {
  const api = await loadSurveyApi()
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    return {
      ok: true,
      json: async () => ({}),
      blob: async () => new Blob(),
    }
  }

  try {
    const locale = "en-US"
    const signal = new AbortController().signal
    await api.apiFetchDefaultTemplate(locale, signal)
    await api.apiCreateRun(locale, "survey", { title: "test" })
    await api.apiFetchRun(locale, "run-1", signal)
    await api.apiCancelRun(locale, "run-1")
    await api.apiSaveRunToHistory(locale, "run-1")
    await api.apiFetchSurveyHistory(locale)
    await api.apiFetchSurveyHistoryById(locale, "history-1")
    await api.apiQueryRunAnalytics(locale, "run-1", { questionId: "q1" })
    await api.apiQueryHistoryAnalytics(locale, "history-1", {
      questionId: "q1",
    })
    await api.apiExportSurveyResults(
      locale,
      { type: "run", id: "run-1" },
      "csv",
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 10)
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("Accept-Language"), "en-US")
  }
  for (const { init } of calls.slice(0, -1)) {
    assert.equal(new Headers(init.headers).get("Content-Type"), "application/json")
  }
  assert.equal(
    new Headers(calls.at(-1).init.headers).get("Content-Type"),
    null,
  )
})

test("shared JSON requests enforce locale across Headers input", async () => {
  const api = await loadSurveyApiWithPrivateRequest()
  const originalFetch = globalThis.fetch
  let capturedHeaders
  globalThis.fetch = async (_url, init = {}) => {
    capturedHeaders = new Headers(init.headers)
    return {
      ok: true,
      json: async () => ({}),
    }
  }

  try {
    await api.__request("en-US", "/test", {
      headers: new Headers([
        ["Accept-Language", "zh-CN"],
        ["X-Test", "preserved"],
      ]),
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(capturedHeaders.get("Accept-Language"), "en-US")
  assert.equal(capturedHeaders.get("Content-Type"), "application/json")
  assert.equal(capturedHeaders.get("X-Test"), "preserved")
})

test("dashboard reloads the default template for the latest selected locale", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /createLatestRequestTracker/)
  assert.match(source, /templateRequestsRef\.current\.begin\(\)/)
  assert.match(source, /templateRequestsRef\.current\.isLatest\(requestId\)/)
  assert.match(source, /setLoadedTemplateLocale\(locale\)/)
  assert.match(
    source,
    /apiFetchDefaultTemplate\(locale,\s*controller\.signal\)/,
  )
})

test("Next rewrites survey API requests", () => {
  const source = readFileSync("next.config.mjs", "utf8")
  assert.ok(source.includes('source: "/survey-api/:path*"'))
  assert.match(source, /SURVEY_BACKEND_URL/)
})

test("dashboard contains no client-side survey orchestration", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  for (const forbidden of [
    "askQuestion",
    "shouldInterviewerTerminate",
    "analyzeSentiment",
    "analyzeQuestionResponses",
    "analyzeByDemographics",
    "apiBuildSurveyResponses",
    "apiGenerateRespondentsFromConfig",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden))
  }
  assert.match(source, /apiCreateRun/)
  assert.match(source, /apiFetchRun/)
})

test("analytics panel delegates business calculations", () => {
  const source = readFileSync("components/analytics-panel.tsx", "utf8")
  for (const forbidden of [
    "analyzeQuestionResponses",
    "filterRespondentsByDimensions",
    "getDimensionMetadata",
    "groupRespondentsByDimensions",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden))
  }
  assert.match(source, /apiQueryRunAnalytics/)
})

test("chat panel imports no mock types", () => {
  const source = readFileSync(
    "components/chat-simulation-panel.tsx",
    "utf8",
  )
  assert.doesNotMatch(source, /mock-survey-service/)
})
