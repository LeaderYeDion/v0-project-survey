import assert from "node:assert/strict"
import test from "node:test"

test("question selection preserves valid IDs and falls back deterministically", async () => {
  const module = await import("../lib/question-selection.ts").catch(() => ({}))

  assert.equal(typeof module.selectValidQuestionId, "function")

  const questions = [{ id: "q1" }, { id: "q2" }]
  assert.equal(module.selectValidQuestionId("q2", questions), "q2")
  assert.equal(module.selectValidQuestionId("old-question", questions), "q1")
  assert.equal(module.selectValidQuestionId("old-question", []), "")
})
