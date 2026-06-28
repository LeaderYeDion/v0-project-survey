import test from "node:test"
import assert from "node:assert/strict"
import { DESKTOP_WORKSPACE_LAYOUT } from "../lib/workspace-layout.mjs"

test("uses balanced desktop workspace defaults", () => {
  assert.deepEqual(DESKTOP_WORKSPACE_LAYOUT.defaults, {
    config: 24,
    results: 52,
    analytics: 24,
  })
  assert.equal(
    Object.values(DESKTOP_WORKSPACE_LAYOUT.defaults).reduce(
      (total, value) => total + value,
      0,
    ),
    100,
  )
})

test("keeps side panels adjustable without collapsing the results workspace", () => {
  assert.deepEqual(DESKTOP_WORKSPACE_LAYOUT.config, { min: 18, max: 40 })
  assert.deepEqual(DESKTOP_WORKSPACE_LAYOUT.results, { min: 34 })
  assert.deepEqual(DESKTOP_WORKSPACE_LAYOUT.analytics, { min: 18, max: 40 })

  assert.ok(
    DESKTOP_WORKSPACE_LAYOUT.config.min +
      DESKTOP_WORKSPACE_LAYOUT.results.min +
      DESKTOP_WORKSPACE_LAYOUT.analytics.min <=
      100,
  )
})
