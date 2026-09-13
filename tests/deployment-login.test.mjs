import "./helpers/register-typescript.mjs"
import assert from "node:assert/strict"
import test, { afterEach } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js"
import { NextRequest } from "next/server.js"
const [{ proxy }, { POST }, deployment, api, { LoginPageContent }, { LocaleProvider }] = await Promise.all([
  import("../proxy.ts"), import("../app/api/auth/login/route.ts"),
  import("../lib/deployment-auth.mjs"), import("../lib/survey-api.ts"),
  import("../app/login/login-page-content.tsx"), import("../components/locale-provider.tsx"),
])

const originalEnvironment = { ...process.env }
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of ["DEPLOY_AUTH_ENABLED", "DEPLOY_USERNAME", "DEPLOY_PASSWORD"]) {
    if (originalEnvironment[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnvironment[key]
  }
})

function enableGate() {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "deployment-owner"
  process.env.DEPLOY_PASSWORD = "test-deployment-secret"
}

function html(stage) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: {} },
    createElement(LocaleProvider, { initialLocale: "en-US" },
      createElement(LoginPageContent, { nextPath: "/", stage }))))
}

test("a fresh enabled browser sees deployment access before research-account login", () => {
  assert.match(html("deployment"), /Deployment access/)
  assert.match(html("deployment"), /Continue to research account/)
  assert.match(html("application"), /research account/i)
  assert.doesNotMatch(html("application"), /Continue to research account/)
})

test("only a verified deployment cookie skips the outer login step", () => {
  enableGate()
  assert.equal(typeof deployment.getDeploymentLoginStage, "function")
  assert.equal(deployment.getDeploymentLoginStage(), "deployment")
  assert.equal(deployment.getDeploymentLoginStage("forged"), "deployment")
  const token = deployment.createDeploymentSession(process.env.DEPLOY_PASSWORD)
  assert.equal(deployment.getDeploymentLoginStage(token), "application")
  delete process.env.DEPLOY_AUTH_ENABLED
  assert.equal(deployment.getDeploymentLoginStage(), "application")
})

test("outer login establishes only the deployment cookie and opens the application API gate", async () => {
  enableGate()
  assert.equal(typeof api.apiDeploymentLogin, "function")
  let cookie = ""
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(url)
    assert.equal(init.credentials, "same-origin")
    const request = new NextRequest(`https://survey.example.test${url}`, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), cookie },
    })
    const gated = proxy(request)
    if (!gated.headers.has("x-middleware-next")) return gated
    if (url === "/api/auth/login") {
      const response = await POST(request)
      cookie = response.headers.get("set-cookie")?.split(";")[0] ?? ""
      return response
    }
    assert.equal(new Headers(init.headers).get("Accept-Language"), "en-US")
    assert.deepEqual(await request.json(), { username: "researcher01", password: "app-secret" })
    return Response.json({ id: "user-1", username: "researcher01", locale: "en-US" })
  }
  await assert.rejects(api.apiLogin("en-US", { username: "researcher01", password: "app-secret" }), {
    code: "DEPLOY_AUTH_REQUIRED", status: 401,
  })
  const outerResult = await api.apiDeploymentLogin("en-US", {
    username: "deployment-owner", password: "test-deployment-secret",
  })
  assert.equal(outerResult, undefined, "deployment access must never return CurrentUser")
  assert.match(cookie, /^survey_deploy_session=/)
  assert.doesNotMatch(cookie, /survey_session=/)
  assert.equal((await api.apiLogin("en-US", { username: "researcher01", password: "app-secret" })).id, "user-1")
  assert.deepEqual(calls, ["/survey-api/auth/login", "/api/auth/login", "/survey-api/auth/login"])
})

test("outer login rejects wrong credentials with stable localized errors and no cookie", async () => {
  enableGate()
  const response = await POST(new NextRequest("https://survey.example.test/api/auth/login", {
    method: "POST", headers: { "Accept-Language": "en-US" },
    body: JSON.stringify({ username: "deployment-owner", password: "wrong" }),
  }))
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("set-cookie"), null)
  assert.deepEqual(await response.json(), {
    code: "DEPLOY_AUTH_INVALID_CREDENTIALS", message: "The username or password is incorrect.", details: null,
  })
})

test("outer login normalizes hostile redirect paths and sets protected cookie attributes", async () => {
  enableGate()
  for (const next of ["//evil.test", "/\\evil.test", "https://evil.test", "/\n/evil.test"]) {
    const response = await POST(new NextRequest("https://survey.example.test/api/auth/login", {
      method: "POST", body: JSON.stringify({ username: "deployment-owner", password: "test-deployment-secret", next }),
    }))
    assert.equal((await response.json()).redirectTo, "/")
    const cookie = response.headers.get("set-cookie")
    for (const attribute of ["HttpOnly", "Secure", "SameSite=strict", "Path=/"]) assert.ok(cookie.includes(attribute))
  }
})
