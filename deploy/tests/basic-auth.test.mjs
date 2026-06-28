import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server.js"
import { proxy } from "../../proxy.ts"
import {
  DEPLOY_SESSION_COOKIE,
  DEPLOY_SESSION_MAX_AGE_SECONDS,
  createDeploymentSession,
  getSafeRedirectPath,
  validateDeploymentCredentials,
  verifyDeploymentSession,
} from "../../lib/deployment-auth.mjs"

const originalEnvironment = {
  DEPLOY_AUTH_ENABLED: process.env.DEPLOY_AUTH_ENABLED,
  DEPLOY_USERNAME: process.env.DEPLOY_USERNAME,
  DEPLOY_PASSWORD: process.env.DEPLOY_PASSWORD,
}

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
})

function request(authorization, path = "/private", headers = {}) {
  return new NextRequest(`https://survey.example.test${path}`, {
    headers: {
      ...(authorization ? { authorization } : {}),
      ...headers,
    },
  })
}

function basic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

test("validates deployment credentials without accepting partial matches", () => {
  assert.equal(
    validateDeploymentCredentials(
      "survey",
      "0123456789abcdef0123456789abcdef",
      "survey",
      "0123456789abcdef0123456789abcdef",
    ),
    true,
  )
  assert.equal(
    validateDeploymentCredentials(
      "survey",
      "wrong-password",
      "survey",
      "0123456789abcdef0123456789abcdef",
    ),
    false,
  )
  assert.equal(
    validateDeploymentCredentials(
      "wrong-user",
      "0123456789abcdef0123456789abcdef",
      "survey",
      "0123456789abcdef0123456789abcdef",
    ),
    false,
  )
})

test("creates a signed session that expires and is invalidated by password rotation", () => {
  const secret = "0123456789abcdef0123456789abcdef"
  const issuedAt = Date.UTC(2026, 5, 28, 12, 0, 0)
  const token = createDeploymentSession(secret, issuedAt)

  assert.equal(verifyDeploymentSession(token, secret, issuedAt), true)
  assert.equal(
    verifyDeploymentSession(
      token,
      secret,
      issuedAt + DEPLOY_SESSION_MAX_AGE_SECONDS * 1000,
    ),
    true,
  )
  assert.equal(
    verifyDeploymentSession(
      token,
      secret,
      issuedAt + (DEPLOY_SESSION_MAX_AGE_SECONDS + 1) * 1000,
    ),
    false,
  )
  assert.equal(
    verifyDeploymentSession(
      `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
      secret,
      issuedAt,
    ),
    false,
  )
  assert.equal(
    verifyDeploymentSession(token, `${secret}-rotated`, issuedAt),
    false,
  )
})

test("only accepts local redirect paths", () => {
  assert.equal(getSafeRedirectPath("/"), "/")
  assert.equal(getSafeRedirectPath("/results?view=latest"), "/results?view=latest")
  assert.equal(getSafeRedirectPath("https://attacker.example"), "/")
  assert.equal(getSafeRedirectPath("//attacker.example"), "/")
  assert.equal(getSafeRedirectPath("javascript:alert(1)"), "/")
  assert.equal(getSafeRedirectPath(null), "/")
})

test("allows requests when deployment auth is disabled", () => {
  delete process.env.DEPLOY_AUTH_ENABLED
  delete process.env.DEPLOY_USERNAME
  delete process.env.DEPLOY_PASSWORD

  const response = proxy(request())

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("x-middleware-next"), "1")
})

test("fails closed when enabled credentials are missing", async () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  delete process.env.DEPLOY_USERNAME
  delete process.env.DEPLOY_PASSWORD

  const response = proxy(request())

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(await response.text(), "Deployment authentication is unavailable")
})

test("redirects unauthenticated HTML navigation to the branded login page", () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "survey"
  process.env.DEPLOY_PASSWORD = "0123456789abcdef0123456789abcdef"

  const response = proxy(
    request(undefined, "/private?tab=analysis", {
      accept: "text/html,application/xhtml+xml",
    }),
  )

  assert.equal(response.status, 307)
  assert.equal(
    response.headers.get("location"),
    "https://survey.example.test/login?next=%2Fprivate%3Ftab%3Danalysis",
  )
  assert.equal(response.headers.get("www-authenticate"), null)
  assert.equal(response.headers.get("cache-control"), "no-store")
})

test("allows the login surface and Next.js static assets without a session", () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "survey"
  process.env.DEPLOY_PASSWORD = "0123456789abcdef0123456789abcdef"

  for (const path of [
    "/login",
    "/api/auth/login",
    "/_next/static/chunks/app/login/page.js",
  ]) {
    const response = proxy(request(undefined, path))
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get("x-middleware-next"), "1", path)
  }
})

test("allows a valid signed session cookie", () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "survey"
  process.env.DEPLOY_PASSWORD = "0123456789abcdef0123456789abcdef"
  const token = createDeploymentSession(process.env.DEPLOY_PASSWORD)

  const response = proxy(
    request(undefined, "/private", {
      cookie: `${DEPLOY_SESSION_COOKIE}=${token}`,
    }),
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("x-middleware-next"), "1")
})

test("rejects missing, malformed, and incorrect credentials without a browser challenge", async () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "survey"
  process.env.DEPLOY_PASSWORD = "0123456789abcdef0123456789abcdef"

  for (const authorization of [
    undefined,
    "Bearer token",
    "Basic not-valid",
    basic("survey", "wrong-password"),
    basic("wrong-user", process.env.DEPLOY_PASSWORD),
  ]) {
    const response = proxy(request(authorization))
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("www-authenticate"), null)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.equal(await response.text(), "Authentication required")
  }
})

test("allows the configured Basic Auth credentials", () => {
  process.env.DEPLOY_AUTH_ENABLED = "true"
  process.env.DEPLOY_USERNAME = "survey"
  process.env.DEPLOY_PASSWORD = "0123456789abcdef0123456789abcdef"

  const response = proxy(
    request(basic(process.env.DEPLOY_USERNAME, process.env.DEPLOY_PASSWORD)),
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("x-middleware-next"), "1")
})
