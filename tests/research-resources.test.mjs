import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("dashboard renders owned project and questionnaire selectors", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /ResearchResourceSelector/)
  assert.match(source, /projectId/)
  assert.match(source, /questionnaireId/)
  assert.match(source, /draftRevision/)
  assert.match(source, /apiSaveQuestionnaireDraft/)
  assert.match(source, /useAuthSession/)
})

test("resource switches abort prior work before changing selection", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(
    source,
    /handleProjectChange[\s\S]*?abortOutstandingSurveyRequests\(\)[\s\S]*?setProjectId/,
  )
  assert.match(
    source,
    /handleQuestionnaireChange[\s\S]*?abortOutstandingSurveyRequests\(\)[\s\S]*?setQuestionnaireId/,
  )
})

test("project dialog submits only the owned project creation fields", () => {
  const source = readFileSync("components/create-project-dialog.tsx", "utf8")
  assert.match(source, /name/)
  assert.match(source, /researchGoal/)
  assert.match(source, /principalName/)
  assert.doesNotMatch(source, /ownerId|userId/)
})

test("questionnaire dialog creates a mode and versioned config", () => {
  const source = readFileSync("components/create-questionnaire-dialog.tsx", "utf8")
  assert.match(source, /mode/)
  assert.match(source, /config/)
  assert.match(source, /schemaVersion:\s*1/)
  assert.doesNotMatch(source, /projectId:\s*|ownerId|userId/)
})

test("draft persistence is debounced and revision-aware", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /setTimeout\([\s\S]*?500/)
  assert.match(source, /expectedRevision:[\s\S]*?job\.revision/)
  assert.match(source, /setDraftRevision\(saved\.draftRevision\)/)
  assert.match(source, /"saving"/)
  assert.match(source, /savedAt/)
  assert.match(source, /"failed"/)
})

test("draft persistence serializes overlapping revisions", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /createDraftSaveQueue/)
  assert.match(source, /draftSaveQueueRef\.current\?\.enqueue\(\{/)
  assert.match(source, /resourceId:\s*savingQuestionnaireId/)
  assert.match(source, /discardPendingExcept\(nextQuestionnaireId\)/)
})

test("new questionnaire starter content comes from the locale catalog", () => {
  const source = readFileSync("components/create-questionnaire-dialog.tsx", "utf8")
  assert.match(source, /messages\.resources\.defaultSurveyQuestion/)
  assert.match(source, /messages\.resources\.defaultInterviewPrompt/)
  assert.doesNotMatch(source, /"Question 1"|"Interview prompt 1"|gender:\s*"Any"/)
})

test("draft conflicts require confirmation and reload the server draft", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /error\.code === "DRAFT_CONFLICT"/)
  assert.match(source, /window\.confirm/)
  assert.match(source, /apiGetQuestionnaire/)
  assert.doesNotMatch(source, /DRAFT_CONFLICT[\s\S]{0,300}apiSaveQuestionnaireDraft/)
})

test("Run is gated while the draft is unsafe", () => {
  const page = readFileSync("app/page.tsx", "utf8")
  const panel = readFileSync("components/survey-config-panel.tsx", "utf8")
  assert.match(page, /isSurveyConfigValid\(config\)/)
  assert.match(page, /saveStatus !== "saved"/)
  assert.match(page, /runDisabled/)
  assert.match(panel, /runDisabled/)
  assert.match(panel, /disabled=\{[^}]*runDisabled/)
})

test("selected questionnaire mode is derived only from the server resource", () => {
  const source = readFileSync("app/page.tsx", "utf8")
  assert.match(source, /setMode\(questionnaire\.mode\)/)
  assert.doesNotMatch(source, /setMode\("(?:survey|interview)"\)/)
  assert.doesNotMatch(source, /handleModeSelection/)
  assert.doesNotMatch(source, /onClick=\{\(\) => setMode/)
  assert.match(source, /CreateQuestionnaireDialog/)
})

test("legacy history controls are explicitly disabled until the round UI lands", () => {
  const page = readFileSync("app/page.tsx", "utf8")
  const analytics = readFileSync("components/analytics-panel.tsx", "utf8")
  const api = readFileSync("lib/survey-api.ts", "utf8")
  assert.match(page, /legacyHistoryEnabled=\{false\}/)
  assert.match(analytics, /legacyHistoryEnabled/)
  assert.match(analytics, /legacyHistoryEnabled &&/)
  assert.doesNotMatch(api, /request\(locale, [`"]\/history/)
})
