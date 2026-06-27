import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const renderer = new URL("../scripts/render-access-policy.mjs", import.meta.url)

async function render(contents, idp = "otp-id") {
  const directory = await mkdtemp(join(tmpdir(), "survey-access-policy-"))
  const file = join(directory, "emails.txt")
  await writeFile(file, contents)
  const result = spawnSync(process.execPath, [renderer.pathname, file, idp], {
    encoding: "utf8",
  })
  await rm(directory, { recursive: true, force: true })
  return result
}

test("renders normalized concrete email rules and requires OTP", async () => {
  const result = await render(
    "# team\nOwner@Example.com\nowner@example.com\nuser@zju.edu.cn\n",
  )
  assert.equal(result.status, 0, result.stderr)
  const policy = JSON.parse(result.stdout)
  assert.deepEqual(policy.include, [
    { email: { email: "owner@example.com" } },
    { email: { email: "user@zju.edu.cn" } },
  ])
  assert.deepEqual(policy.require, [{ login_method: { id: "otp-id" } }])
  assert.equal(policy.decision, "allow")
})

test("rejects empty and invalid allowlists", async () => {
  const empty = await render("# no users\n")
  assert.notEqual(empty.status, 0)
  const invalid = await render("not-an-email\n")
  assert.notEqual(invalid.status, 0)
})
