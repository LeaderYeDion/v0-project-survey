import { createHmac, timingSafeEqual } from "node:crypto"

export const DEPLOY_SESSION_COOKIE = "survey_deploy_session"
export const DEPLOY_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60

const SESSION_CONTEXT = "survey-agent-session-v1"

/**
 * @param {string} actual
 * @param {string} expected
 */
function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

/**
 * @param {number} issuedAtSeconds
 * @param {string} secret
 */
function signSession(issuedAtSeconds, secret) {
  return createHmac("sha256", secret)
    .update(`${SESSION_CONTEXT}:${issuedAtSeconds}`)
    .digest("base64url")
}

export function validateDeploymentCredentials(
  username,
  password,
  expectedUsername,
  expectedPassword,
) {
  const usernameMatches = safeEqual(username, expectedUsername)
  const passwordMatches = safeEqual(password, expectedPassword)
  return usernameMatches && passwordMatches
}

export function createDeploymentSession(
  secret,
  nowMilliseconds = Date.now(),
) {
  const issuedAtSeconds = Math.floor(nowMilliseconds / 1000)
  return `${issuedAtSeconds}.${signSession(issuedAtSeconds, secret)}`
}

export function verifyDeploymentSession(
  token,
  secret,
  nowMilliseconds = Date.now(),
) {
  if (!token) return false

  const match = token.match(/^(\d+)\.([A-Za-z0-9_-]{43})$/)
  if (!match) return false

  const issuedAtSeconds = Number(match[1])
  const nowSeconds = Math.floor(nowMilliseconds / 1000)
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds ||
    nowSeconds - issuedAtSeconds > DEPLOY_SESSION_MAX_AGE_SECONDS
  ) {
    return false
  }

  return safeEqual(match[2], signSession(issuedAtSeconds, secret))
}

export function getSafeRedirectPath(value) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return "/"
  }

  return value
}
