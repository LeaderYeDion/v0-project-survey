import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

import { messages } from "../lib/i18n/messages.ts"

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

test("renderInferenceValue handles scalar, multi-value, and empty values", async () => {
  const { renderInferenceValue } = await loadSurveyContract()

  assert.equal(renderInferenceValue("积极"), "积极")
  assert.equal(renderInferenceValue(["父母", "子女"]), "父母, 子女")
  assert.equal(renderInferenceValue(["父母", "子女"], "、"), "父母、子女")
  assert.equal(renderInferenceValue(null), "")
})

test("inference task copy explains purpose, output, and run state", () => {
  const zh = messages["zh-CN"].config
  const en = messages["en-US"].config

  assert.match(zh.inferenceDescription, /访谈结束后/)
  assert.match(zh.inferenceOutputHint, /结果/)
  assert.equal(zh.enableInferenceTasks, "运行访谈推断")
  assert.equal(zh.profileInferenceDescription, "从访谈文本推断受访者画像字段，如家庭收入、成员关系、消费支出。")
  assert.equal(zh.attitudeInferenceDescription, "判断受访者对共同富裕、公共服务、向上流动等主题的态度。")
  assert.equal(zh.enabledTaskCount(2, 5), "将运行 2 / 5 项")
  assert.equal(zh.noEnabledTasks, "当前没有选中任务，运行后不会生成推断结果。")

  assert.match(en.inferenceDescription, /after each interview/i)
  assert.match(en.inferenceOutputHint, /results/i)
  assert.equal(en.enableInferenceTasks, "Run interview inference")
  assert.equal(en.profileInferenceDescription, "Infer respondent profile fields from the interview, such as household income, family members, and spending categories.")
  assert.equal(en.attitudeInferenceDescription, "Classify the respondent's attitude toward common prosperity, public services, upward mobility, and related themes.")
  assert.equal(en.enabledTaskCount(2, 5), "Runs 2 / 5 tasks")
  assert.equal(en.noEnabledTasks, "No tasks are selected, so the run will not generate inference results.")
})

test("inference task panel renders explanatory controls and task counts", () => {
  const source = readFileSync("components/survey-config-panel.tsx", "utf8")

  assert.match(source, /messages\.config\.inferenceOutputHint/)
  assert.match(source, /messages\.config\.enableInferenceTasks/)
  assert.match(source, /messages\.config\.profileInferenceDescription/)
  assert.match(source, /messages\.config\.attitudeInferenceDescription/)
  assert.match(source, /messages\.config\.enabledTaskCount/)
  assert.match(source, /messages\.config\.noEnabledTasks/)
  assert.match(source, /enabledTaskCount=\{countEnabledTasks\(inferenceConfig\.profileTasks\)\}/)
  assert.match(source, /enabledTaskCount=\{countEnabledTasks\(inferenceConfig\.attitudeTasks\)\}/)
})
