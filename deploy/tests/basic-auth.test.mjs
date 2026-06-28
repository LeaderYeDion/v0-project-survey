import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import { NextRequest } from "next/server.js"
import { proxy } from "../../proxy.ts"

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

function request(authorization) {
  return new NextRequest("https://survey.example.test/private", {
    headers: authorization ? { authorization } : {},
  })
}

function basic(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

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

test("challenges missing, malformed, and incorrect credentials", async () => {
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
    assert.equal(
      response.headers.get("www-authenticate"),
      'Basic realm="Survey Agent", charset="UTF-8"',
    )
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
