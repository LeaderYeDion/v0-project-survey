import test from "node:test"
import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"

const read = path =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8")

test("starts a Quick Tunnel to the loopback-only origin", async () => {
  const start = await read("deploy/scripts/start.sh")

  assert.match(start, /cloudflared tunnel/)
  assert.match(start, /--url/)
  assert.match(start, /127\.0\.0\.1/)
  assert.match(start, /trycloudflare\\?\.com/)
  assert.doesNotMatch(start, /-H\s+0\.0\.0\.0/)
  assert.doesNotMatch(
    start,
    /TUNNEL_NAME|PUBLIC_HOSTNAME|ACCESS_POLICY|CLOUDFLARE_API_TOKEN/,
  )
})

test("rolls failed starts back for ordinary exits and signals", async () => {
  const start = await read("deploy/scripts/start.sh")

  assert.match(start, /trap\s+rollback/)
  assert.match(start, /trap\s+cleanup_on_exit\s+EXIT/)
  assert.match(start, /remove_public_url/)
})

test("stops tunnel and removes its URL before stopping Next.js", async () => {
  const stop = await read("deploy/scripts/stop.sh")
  const tunnel = stop.indexOf('stop_role "cloudflared"')
  const publicUrl = stop.indexOf("remove_public_url")
  const next = stop.indexOf('stop_role "next"')

  assert.ok(tunnel >= 0)
  assert.ok(publicUrl > tunnel)
  assert.ok(next > publicUrl)
  assert.match(stop, /verify-shutdown\.sh/)
})

test("package scripts expose only the zero-cost lifecycle", async () => {
  const pkg = JSON.parse(await read("package.json"))

  assert.equal(pkg.scripts["deploy:init"], "bash deploy/scripts/init-config.sh")
  assert.equal(pkg.scripts["deploy:start"], "bash deploy/scripts/start.sh")
  assert.equal(pkg.scripts.stop, "bash deploy/scripts/stop.sh")
  assert.equal(
    pkg.scripts["deploy:verify-stopped"],
    "bash deploy/scripts/verify-shutdown.sh",
  )
  assert.equal(pkg.scripts["deploy:sync-access"], undefined)
})

test("deployment entrypoint scripts are executable", async () => {
  const scripts = [
    "init-config.sh",
    "check-prerequisites.sh",
    "start.sh",
    "stop.sh",
    "status.sh",
    "verify-shutdown.sh",
  ]

  for (const script of scripts) {
    const metadata = await stat(
      new URL(`../scripts/${script}`, import.meta.url),
    )
    assert.notEqual(metadata.mode & 0o111, 0, `${script} is not executable`)
  }
})

test("recognizes the Next 16 process title and keeps rollback cleanup recoverable", async () => {
  const common = await read("deploy/scripts/common.sh")

  assert.match(common, /process_cwd/)
  assert.match(common, /next-server/)
  assert.match(common, /refusing to kill it.*return 1/s)
})

test("allows Quick Tunnel DNS to warm up before public verification", async () => {
  const start = await read("deploy/scripts/start.sh")
  const warmup = start.indexOf("sleep 15")
  const verification = start.indexOf("public_ready=0")

  assert.ok(warmup >= 0)
  assert.ok(verification > warmup)
})
