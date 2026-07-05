import assert from "node:assert/strict"
import test from "node:test"

test("analytics query keys normalize filters and distinguish query identity", async () => {
  const module = await import("../lib/analytics-query-key.ts").catch(() => ({}))

  assert.equal(typeof module.createAnalyticsSourceKey, "function")
  assert.equal(typeof module.createAnalyticsQueryKey, "function")

  const runSource = module.createAnalyticsSourceKey({ type: "run", id: "1" })
  const historySource = module.createAnalyticsSourceKey({
    type: "history",
    id: "1",
  })
  assert.notEqual(runSource, historySource)
  assert.notEqual(runSource, module.createAnalyticsSourceKey({ type: "run", id: "2" }))
  assert.equal(module.createAnalyticsSourceKey(null), "")

  const base = {
    sourceKey: runSource,
    questionId: "q1",
    locale: "en-US",
    filters: { city: "Hangzhou", income: "20-30" },
    groupBy: ["city", "income"],
  }
  const key = module.createAnalyticsQueryKey(base)

  assert.equal(
    key,
    module.createAnalyticsQueryKey({
      ...base,
      filters: { income: "20-30", city: "Hangzhou" },
    }),
  )
  for (const changed of [
    { ...base, sourceKey: historySource },
    { ...base, questionId: "q2" },
    { ...base, locale: "zh-CN" },
    { ...base, filters: { city: "Shanghai", income: "20-30" } },
    { ...base, groupBy: ["income", "city"] },
  ]) {
    assert.notEqual(key, module.createAnalyticsQueryKey(changed))
  }
})
