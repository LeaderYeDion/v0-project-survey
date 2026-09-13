import "./helpers/register-typescript.mjs"
import assert from "node:assert/strict"
import test from "node:test"
const requests = await import("../lib/latest-request.ts")
const api = await import("../lib/survey-api.ts")

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test("cleanup aborts the actual resource request and suppresses a late success", async () => {
  assert.equal(typeof requests.createEffectRequestTracker, "function")
  const tracker = requests.createEffectRequestTracker(() => "user-1/en-US/project-1")
  const response = deferred()
  let signal
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_url, init) => { signal = init.signal; return response.promise }
  try {
    const request = tracker.begin()
    const pending = request.run(signal => api.apiListQuestionnaires("en-US", "project-1", signal))
    request.abort()
    assert.equal(signal.aborted, true)
    response.resolve(Response.json([{ id: "old-questionnaire" }]))
    assert.deepEqual(await pending, { status: "stale" })
  } finally { globalThis.fetch = originalFetch }
})

for (const outcome of ["resolve", "reject"]) {
  test(`an old effect's ${outcome} cannot win after same-identity replacement`, async () => {
    assert.equal(typeof requests.createEffectRequestTracker, "function")
    const tracker = requests.createEffectRequestTracker(() => "user-1/en-US/questionnaire-1")
    const oldResponse = deferred()
    const old = tracker.begin().run(() => oldResponse.promise)
    const latest = tracker.begin().run(async () => ({ id: "latest" }))
    oldResponse[outcome](outcome === "resolve" ? { id: "old" } : new Error("stale failure"))
    assert.deepEqual(await latest, { status: "success", value: { id: "latest" } })
    assert.deepEqual(await old, { status: "stale" })
  })
  test(`a resource or user identity change suppresses a late ${outcome} before effect cleanup`, async () => {
    assert.equal(typeof requests.createEffectRequestTracker, "function")
    let identity = "user-1/en-US/project-1/questionnaire-1"
    const tracker = requests.createEffectRequestTracker(() => identity)
    const response = deferred()
    const pending = tracker.begin().run(() => response.promise)
    identity = "user-2/zh-CN/project-2/questionnaire-2"
    response[outcome](outcome === "resolve" ? { id: "old" } : new Error("old account failure"))
    assert.deepEqual(await pending, { status: "stale" })
  })
}

test("the latest effect exposes an actual failure for current-resource feedback", async () => {
  assert.equal(typeof requests.createEffectRequestTracker, "function")
  const tracker = requests.createEffectRequestTracker(() => "current")
  const error = new Error("storage unavailable")
  assert.deepEqual(await tracker.begin().run(async () => { throw error }), { status: "error", error })
})
