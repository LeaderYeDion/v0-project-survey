import assert from "node:assert/strict"
import test from "node:test"

test("latest request tracker invalidates every older overlapping request", async () => {
  const module = await import("../lib/latest-request.ts").catch(() => ({}))

  assert.equal(typeof module.createLatestRequestTracker, "function")

  const tracker = module.createLatestRequestTracker()
  const first = tracker.begin()
  const second = tracker.begin()

  assert.equal(tracker.isLatest(first), false)
  assert.equal(tracker.isLatest(second), true)

  const third = tracker.begin()
  assert.equal(tracker.isLatest(second), false)
  assert.equal(tracker.isLatest(third), true)
})
