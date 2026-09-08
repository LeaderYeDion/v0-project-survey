import assert from "node:assert/strict"
import test from "node:test"

test("a Q2 save queued during an in-flight Q1 save runs after Q1 settles", async () => {
  const { createDraftSaveQueue } = await import("../lib/draft-save-queue.ts")
  let releaseQ1
  const q1Blocked = new Promise(resolve => {
    releaseQ1 = resolve
  })
  const calls = []
  const queue = createDraftSaveQueue(async job => {
    calls.push([job.resourceId, job.revision])
    if (job.resourceId === "q1") await q1Blocked
  })

  const q1 = queue.enqueue({ resourceId: "q1", revision: 4 })
  await Promise.resolve()
  queue.discardPendingExcept("q2")
  const q2 = queue.enqueue({ resourceId: "q2", revision: 11 })

  assert.deepEqual(calls, [["q1", 4]])
  releaseQ1()
  await Promise.all([q1, q2])
  assert.deepEqual(calls, [["q1", 4], ["q2", 11]])
})

test("pending edits coalesce to the newest task for the selected resource", async () => {
  const { createDraftSaveQueue } = await import("../lib/draft-save-queue.ts")
  let releaseQ1
  const q1Blocked = new Promise(resolve => {
    releaseQ1 = resolve
  })
  const calls = []
  const queue = createDraftSaveQueue(async job => {
    calls.push([job.resourceId, job.revision])
    if (job.resourceId === "q1") await q1Blocked
  })

  const q1 = queue.enqueue({ resourceId: "q1", revision: 1 })
  await Promise.resolve()
  const staleQ2 = queue.enqueue({ resourceId: "q2", revision: 8 })
  const latestQ2 = queue.enqueue({ resourceId: "q2", revision: 9 })
  releaseQ1()
  await Promise.all([q1, staleQ2, latestQ2])

  assert.deepEqual(calls, [["q1", 1], ["q2", 9]])
})
