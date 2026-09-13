import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"

// Run with an installed Playwright runtime, or point PLAYWRIGHT_MODULE at one.
// The backend fixture replaces PostgreSQL; Next routes, proxy, cookies and UI are real.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")

async function startApplication(t, enabled, handleResource) {
  const backendCalls = []
  const backend = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    backendCalls.push({ path: request.url, body })
    response.setHeader("content-type", "application/json")
    if (request.url === "/api/auth/login") {
      if (body !== JSON.stringify({ username: "researcher01", password: "research-secret" })) {
        response.writeHead(401).end(JSON.stringify({ code: "AUTH_INVALID_CREDENTIALS", message: "Invalid account", details: null }))
        return
      }
      response.setHeader("set-cookie", ["survey_session=application-test; HttpOnly; SameSite=Strict; Path=/", "survey_csrf=csrf-test; SameSite=Strict; Path=/"])
    } else if (!request.headers.cookie?.includes("survey_session=application-test")) {
      response.writeHead(401).end(JSON.stringify({ code: "AUTH_SESSION_EXPIRED", message: "Sign in", details: null }))
      return
    }
    if (handleResource?.(request, response)) return
    response.end(JSON.stringify(request.url === "/api/projects" ? [] : {
      id: "research-user", username: "researcher01", locale: "en-US",
    }))
  })
  backend.listen(0, "127.0.0.1")
  await once(backend, "listening")
  t.after(() => { backend.closeAllConnections(); backend.close() })
  const reservation = createServer()
  reservation.listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DEPLOY_AUTH_ENABLED: String(enabled),
      DEPLOY_USERNAME: "deployment-owner", DEPLOY_PASSWORD: "deployment-secret",
      SURVEY_BACKEND_URL: `http://127.0.0.1:${backend.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  server.stdout.on("data", chunk => { output += chunk })
  server.stderr.on("data", chunk => { output += chunk })
  t.after(async () => {
    if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit") }
  })
  const baseURL = `http://127.0.0.1:${port}`
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(output)
    try { if ((await fetch(`${baseURL}/login`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, `Next server did not become ready: ${output}`)
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ locale: "en-US" })
  await context.addCookies([{ name: "survey_locale", value: "en-US", url: baseURL }])
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  return { page, context, baseURL, backendCalls }
}

test("enabled gate requires two separate credentials before the workspace opens", { timeout: 120_000 }, async t => {
  const { page, context, baseURL, backendCalls } = await startApplication(t, true)
  const pageErrors = []
  page.on("pageerror", error => pageErrors.push(error.message))
  await page.goto(`${baseURL}/?tab=analysis`)
  await page.getByRole("heading", { name: "Deployment access", exact: true }).waitFor()
  assert.equal(backendCalls.length, 0, "login must not probe application identity before outer access")
  await page.getByLabel("Username", { exact: true }).fill("deployment-owner")
  await page.getByLabel("Password", { exact: true }).fill("wrong")
  await page.getByRole("button", { name: "Continue to research account", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: /username or password/i }).waitFor()
  assert.equal((await context.cookies()).some(cookie => cookie.name === "survey_deploy_session"), false)
  await page.getByLabel("Password", { exact: true }).fill("deployment-secret")
  await page.getByRole("button", { name: "Continue to research account", exact: true }).click()
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor()
  assert.equal(await page.getByLabel("Username", { exact: true }).inputValue(), "")
  assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "")
  assert.equal((await context.cookies()).some(cookie => cookie.name === "survey_session"), false)
  assert.equal(backendCalls.length, 0)
  await page.getByLabel("Username", { exact: true }).fill("researcher01")
  await page.getByLabel("Password", { exact: true }).fill("research-secret")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.getByRole("heading", { name: "Create your first research project" }).waitFor()
  assert.equal(new URL(page.url()).search, "?tab=analysis")
  assert.equal(await page.getByText("researcher01", { exact: true }).count(), 1)
  assert.ok(backendCalls.some(call => call.path === "/api/auth/me"))
  assert.deepEqual(pageErrors, [])
})

for (const outcome of ["success", "failure"]) {
  test(`project switching suppresses a stale ${outcome} even when transport ignores abort`, { timeout: 120_000 }, async t => {
    let releaseOld, oldStarted
    const oldRequest = new Promise(resolve => { oldStarted = resolve })
    const timestamp = "2026-09-13T00:00:00Z"
    const project = id => ({ id, name: `Project ${id}`, researchGoal: "Goal", principalName: "Researcher", createdAt: timestamp, updatedAt: timestamp })
    const questionnaire = id => ({
      id: `q-${id}`, projectId: id, mode: "survey", title: `Questionnaire ${id}`, description: "",
      config: { title: `Questionnaire ${id}`, description: "", questions: [], respondentConfigs: [], maxResponseTime: 30 },
      schemaVersion: 1, draftRevision: 1, createdAt: timestamp, updatedAt: timestamp,
    })
    const { page, baseURL } = await startApplication(t, false, (request, response) => {
      if (request.url === "/api/projects") response.end(JSON.stringify([project("A"), project("B")]))
      else if (request.url === "/api/projects/A/questionnaires") {
        releaseOld = () => {
          response.statusCode = outcome === "failure" ? 503 : 200
          response.end(JSON.stringify(outcome === "failure"
            ? { code: "STORAGE_UNAVAILABLE", message: "old request failed", details: null }
            : [questionnaire("A")]))
        }
        oldStarted()
      } else if (request.url === "/api/projects/B/questionnaires") response.end(JSON.stringify([questionnaire("B")]))
      else if (request.url === "/api/questionnaires/q-A") response.end(JSON.stringify(questionnaire("A")))
      else if (request.url === "/api/questionnaires/q-B") response.end(JSON.stringify(questionnaire("B")))
      else return false
      return true
    })
    await page.addInitScript(() => {
      const transport = window.fetch
      window.fetch = (url, init) => transport(url, { ...init, signal: undefined })
    })
    await page.goto(`${baseURL}/login`)
    await page.getByLabel("Username", { exact: true }).fill("researcher01")
    await page.getByLabel("Password", { exact: true }).fill("research-secret")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await oldRequest
    await page.getByRole("combobox", { name: "Select a project", exact: true }).click()
    await page.getByRole("option", { name: "Project B", exact: true }).click()
    await page.getByRole("combobox", { name: "Select a questionnaire or interview", exact: true }).filter({ hasText: "Questionnaire B" }).waitFor()
    const responseReceived = page.waitForResponse(response => response.url().endsWith("/projects/A/questionnaires"))
    releaseOld()
    await responseReceived
    // Wait for the delayed response body and React update, not just response headers.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.getByRole("combobox", { name: "Select a questionnaire or interview", exact: true }).innerText(), "Questionnaire B")
    assert.equal(await page.getByRole("alert").filter({ hasText: "Unable to load research resources" }).count(), 0)
  })
}

test("default gate off opens application login directly and normalizes external next", { timeout: 120_000 }, async t => {
  const { page, context, baseURL } = await startApplication(t, false)
  await page.goto(`${baseURL}/login?next=${encodeURIComponent("//evil.test/")}`)
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor()
  assert.equal(await page.getByRole("heading", { name: "Deployment access" }).count(), 0)
  await page.getByLabel("Username", { exact: true }).fill("researcher01")
  await page.getByLabel("Password", { exact: true }).fill("research-secret")
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.getByRole("heading", { name: "Create your first research project" }).waitFor()
  assert.equal(page.url(), `${baseURL}/`)
  assert.equal((await context.cookies()).some(cookie => cookie.name === "survey_deploy_session"), false)
})
