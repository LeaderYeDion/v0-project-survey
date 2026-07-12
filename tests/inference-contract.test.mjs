import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

async function loadSurveyContract() {
  const source = readFileSync("lib/survey-contract.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
}

test("default inference config is disabled with editable presets", async () => {
  const { createDefaultInferenceConfig } = await loadSurveyContract()
  const config = createDefaultInferenceConfig()

  assert.equal(config.enabled, false)
  assert.equal(config.profileEnabled, false)
  assert.equal(config.attitudeEnabled, false)
  assert.ok(config.profileTasks.some(task => task.name === "家庭年收入"))
  assert.ok(config.profileTasks.some(task => task.multiple === true))
  assert.ok(config.attitudeTasks.some(task => task.name === "共同富裕倾向"))
  assert.deepEqual(config.attitudeTasks[0].options, ["积极", "中立", "消极"])
})
