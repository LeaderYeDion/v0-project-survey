import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("survey API uses the same-origin backend path", () => {
  const source = readFileSync("lib/survey-api.ts", "utf8")
  assert.ok(source.includes('const API_BASE = "/survey-api"'))
  assert.doesNotMatch(source, /mock-survey-service/)
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
