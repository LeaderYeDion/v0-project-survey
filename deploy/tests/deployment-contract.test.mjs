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

test("starts and health-checks FastAPI behind the authenticated Next.js proxy", async () => {
  const start = await read("deploy/scripts/start.sh")

  assert.match(start, /backend\/\.venv\/bin\/uvicorn/)
  assert.match(start, /--host\s+"\$BACKEND_HOST"/)
  assert.match(start, /--port\s+"\$BACKEND_PORT"/)
  assert.match(start, /\/api\/health/)
  assert.match(start, /\/survey-api\/health/)
  assert.match(start, /backend\.log/)
})

test("rolls FastAPI back after Next.js and before releasing the lifecycle lock", async () => {
  const start = await read("deploy/scripts/start.sh")
  const stopNext = start.indexOf('stop_role "next"')
  const stopBackend = start.indexOf('stop_role "backend"')
  const releaseLock = start.indexOf("release_lock")

  assert.ok(stopNext >= 0)
  assert.ok(stopBackend > stopNext)
  assert.ok(releaseLock > stopBackend)
})

test("stops tunnel and removes its URL before stopping Next.js and FastAPI", async () => {
  const stop = await read("deploy/scripts/stop.sh")
  const tunnel = stop.indexOf('stop_role "cloudflared"')
  const publicUrl = stop.indexOf("remove_public_url")
  const next = stop.indexOf('stop_role "next"')
  const backend = stop.indexOf('stop_role "backend"')

  assert.ok(tunnel >= 0)
  assert.ok(publicUrl > tunnel)
  assert.ok(next > publicUrl)
  assert.ok(backend > next)
  assert.match(stop, /verify-shutdown\.sh/)
})

test("status and shutdown verification cover FastAPI and both loopback ports", async () => {
  const common = await read("deploy/scripts/common.sh")
  const status = await read("deploy/scripts/status.sh")
  const verify = await read("deploy/scripts/verify-shutdown.sh")

  assert.match(common, /next\s*\|\s*backend\s*\|\s*cloudflared/)
  assert.match(common, /matching_backend_processes/)
  assert.match(status, /backend_ok/)
  assert.match(status, /BACKEND_PORT/)
  assert.match(verify, /cloudflared next backend/)
  assert.match(verify, /BACKEND_PORT/)
})

test("deployment configuration and prerequisites require the local Python backend", async () => {
  const common = await read("deploy/scripts/common.sh")
  const init = await read("deploy/scripts/init-config.sh")
  const example = await read("deploy/config/deploy.env.example")
  const prerequisites = await read("deploy/scripts/check-prerequisites.sh")

  for (const source of [common, init, example]) {
    assert.match(source, /BACKEND_HOST/)
    assert.match(source, /BACKEND_PORT/)
    assert.match(source, /SURVEY_BACKEND_URL/)
  }
  assert.match(prerequisites, /backend\/\.venv\/bin\/python/)
  assert.match(prerequisites, /backend\/scripts\/bootstrap\.sh/)
  assert.match(prerequisites, /3,\s*14,\s*6/)
})

test("allows a configurable backend port while keeping the backend loopback-only", async () => {
  const common = await read("deploy/scripts/common.sh")

  assert.doesNotMatch(common, /\[ "\$BACKEND_PORT" = "8000" \]/)
  assert.match(common, /\$BACKEND_PORT.*\^\[0-9\]\+\$/s)
  assert.match(
    common,
    /SURVEY_BACKEND_URL.*http:\/\/\$BACKEND_HOST:\$BACKEND_PORT/s,
  )
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

test("provides a branded login page backed by a secure session route", async () => {
  const route = await read("app/api/auth/login/route.ts")
  const page = await read("app/login/page.tsx")
  const form = await read("app/login/login-form.tsx")

  assert.match(route, /validateDeploymentCredentials/)
  assert.match(route, /createDeploymentSession/)
  assert.match(route, /getSafeRedirectPath/)
  assert.match(route, /httpOnly:\s*true/)
  assert.match(route, /sameSite:\s*"strict"/)
  assert.match(route, /DEPLOY_SESSION_MAX_AGE_SECONDS/)
  assert.match(route, /用户名或密码不正确/)
  assert.match(page, /Survey Agent Simulator/)
  assert.match(page, /LoginForm/)
  assert.match(form, /用户名/)
  assert.match(form, /密码/)
  assert.match(form, /api\/auth\/login/)
})
