import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server.js"
import type { NextRequest } from "next/server.js"

const challengeHeaders = {
  "Cache-Control": "no-store",
  "WWW-Authenticate": 'Basic realm="Survey Agent", charset="UTF-8"',
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

function rejectCredentials() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: challengeHeaders,
  })
}

export function proxy(request: NextRequest) {
  if (process.env.DEPLOY_AUTH_ENABLED !== "true") {
    return NextResponse.next()
  }

  const expectedUsername = process.env.DEPLOY_USERNAME
  const expectedPassword = process.env.DEPLOY_PASSWORD
  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Deployment authentication is unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  }

  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Basic ")) {
    return rejectCredentials()
  }

  const encodedCredentials = authorization.slice("Basic ".length).trim()
  if (
    encodedCredentials.length === 0 ||
    encodedCredentials.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedCredentials)
  ) {
    return rejectCredentials()
  }

  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString(
    "utf8",
  )
  const separator = decodedCredentials.indexOf(":")
  if (separator < 0) {
    return rejectCredentials()
  }

  const username = decodedCredentials.slice(0, separator)
  const password = decodedCredentials.slice(separator + 1)
  if (
    !safeEqual(username, expectedUsername) ||
    !safeEqual(password, expectedPassword)
  ) {
    return rejectCredentials()
  }

  return NextResponse.next()
}
