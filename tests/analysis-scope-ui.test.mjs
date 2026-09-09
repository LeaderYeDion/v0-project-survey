import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("analysis scope always renders population, filtered, valid, and excluded counts", () => {
  const source = readFileSync("components/analysis-scope-summary.tsx", "utf8")

  for (const field of [
    "populationCount",
    "filteredRespondentCount",
    "validResponseCount",
    "excludedResponseCount",
  ]) {
    assert.match(source, new RegExp(`scope\\.${field}`))
  }
  assert.match(source, /scope\.smallSample/)
  assert.match(source, /scope\.label/)
})

test("analytics uses mode-specific survey and interview wording", () => {
  const source = readFileSync("components/analytics-panel.tsx", "utf8")

  assert.match(source, /mode:\s*SimulationMode/)
  assert.match(source, /mode === "survey"/)
  assert.match(source, /messages\.analytics\.surveyCompletionRate/)
  assert.match(source, /messages\.analytics\.interviewCompletionRate/)
  assert.match(source, /messages\.analytics\.surveyAnswerDistribution/)
  assert.match(source, /messages\.analytics\.interviewDialogDistribution/)
})

test("exception drilldown focuses the selected respondent", () => {
  const source = readFileSync("components/exception-drilldown.tsx", "utf8")

  assert.match(source, /selectedGroup\.respondents/)
  assert.match(source, /onFocusRespondent\(respondent\.respondentId\)/)
  assert.match(source, /lastValidAnswer/)
  assert.match(source, /completedQuestions/)
  assert.match(source, /totalQuestions/)
})
