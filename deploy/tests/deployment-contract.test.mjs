import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const read = path =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

test("binds Next.js to loopback and rolls back failed starts", async () => {
  const start = await read("deploy/scripts/start.sh")
  assert.match(start, /127\.0\.0\.1/)
  assert.doesNotMatch(start, /-H\s+0\.0\.0\.0/)
  assert.match(start, /trap\s+rollback/)
})

test("stops tunnel before Next.js and verifies shutdown", async () => {
  const stop = await read("deploy/scripts/stop.sh")
  const tunnel = stop.indexOf('stop_role "cloudflared"')
  const next = stop.indexOf('stop_role "next"')
  assert.ok(tunnel >= 0)
  assert.ok(next > tunnel)
  assert.match(stop, /verify-shutdown\.sh/)
})

test("tunnel template exposes one loopback origin and ends in 404", async () => {
  const config = await read("deploy/config/config.yml.example")
  const services = config.match(/service:/g) ?? []
  assert.equal(services.length, 2)
  assert.match(config, /service:\s+http:\/\/127\.0\.0\.1:3000/)
  assert.match(config, /-\s+service:\s+http_status:404\s*$/)
  assert.doesNotMatch(config, /(ssh|rdp|tcp):\/\//)
})

test("package scripts expose one-command lifecycle operations", async () => {
  const pkg = JSON.parse(await read("package.json"))
  assert.equal(pkg.scripts["deploy:start"], "bash deploy/scripts/start.sh")
  assert.equal(pkg.scripts.stop, "bash deploy/scripts/stop.sh")
  assert.equal(
    pkg.scripts["deploy:verify-stopped"],
    "bash deploy/scripts/verify-shutdown.sh",
  )
})
