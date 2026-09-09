import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

async function loadRunActions() {
  const source = readFileSync("lib/run-actions.ts", "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  )
}

test("run actions match active and terminal states", async () => {
  const { allowedRunActions } = await loadRunActions()

  assert.deepEqual(allowedRunActions("queued", 0, 4), ["cancel"])
  assert.deepEqual(allowedRunActions("running", 0, 0), ["pause", "cancel"])
  assert.deepEqual(allowedRunActions("pausing", 0, 2), ["cancel"])
  assert.deepEqual(allowedRunActions("paused", 0, 2), ["resume", "cancel"])
  assert.deepEqual(allowedRunActions("completed", 0, 0), [])
  assert.deepEqual(allowedRunActions("completed_with_errors", 2, 0), ["retry_failed"])
  assert.deepEqual(allowedRunActions("completed_with_errors", 0, 0), [])
  assert.deepEqual(allowedRunActions("cancelled", 0, 3), ["retry_incomplete"])
  assert.deepEqual(allowedRunActions("cancelled", 0, 0), [])
  assert.deepEqual(allowedRunActions("failed", 1, 1), [])
})

test("polling is limited to queued, running, and pausing rounds", async () => {
  const { shouldPollRound } = await loadRunActions()

  for (const status of ["queued", "running", "pausing"]) {
    assert.equal(shouldPollRound(status), true, status)
  }
  for (const status of ["paused", "completed", "completed_with_errors", "cancelled", "failed"]) {
    assert.equal(shouldPollRound(status), false, status)
  }
})

test("mutation guard coalesces duplicate submissions and opens after settlement", async () => {
  const { createRunMutationGuard } = await loadRunActions()
  const guard = createRunMutationGuard()
  let resolveFirst
  let calls = 0
  const first = guard.run("pause", () => {
    calls += 1
    return new Promise(resolve => {
      resolveFirst = resolve
    })
  })

  const duplicate = await guard.run("pause", async () => {
    calls += 1
    return "duplicate"
  })
  assert.equal(duplicate, null)
  assert.equal(calls, 1)
  assert.equal(guard.pendingAction(), "pause")

  resolveFirst("paused snapshot")
  assert.equal(await first, "paused snapshot")
  assert.equal(guard.pendingAction(), null)
  assert.equal(await guard.run("resume", async () => "running snapshot"), "running snapshot")
})

test("poll responses cannot overwrite a newer mutation snapshot or another round", async () => {
  const { mergePolledRoundSnapshot } = await loadRunActions()
  const current = { id: "round-1", rowVersion: 8, status: "pausing" }

  assert.equal(
    mergePolledRoundSnapshot(current, { id: "round-1", rowVersion: 7, status: "running" }, "round-1"),
    current,
  )
  assert.equal(
    mergePolledRoundSnapshot(current, { id: "round-1", rowVersion: 9, status: "paused" }, "round-1").status,
    "paused",
  )
  assert.equal(
    mergePolledRoundSnapshot(
      { id: "round-2", rowVersion: 1, status: "queued" },
      { id: "round-1", rowVersion: 9, status: "running" },
      "round-1",
    ).id,
    "round-2",
  )
  assert.equal(
    mergePolledRoundSnapshot(
      null,
      { id: "round-1", rowVersion: 9, status: "running" },
      "round-1",
    ),
    null,
  )
})
