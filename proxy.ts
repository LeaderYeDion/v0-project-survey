import { NextResponse } from "next/server.js"
import type { NextRequest } from "next/server.js"
import {
  DEPLOY_SESSION_COOKIE,
  getSafeRedirectPath,
  validateDeploymentCredentials,
  verifyDeploymentSession,
} from "./lib/deployment-auth.mjs"

function rejectCredentials() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  })
}

function isPublicAuthenticationPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname.startsWith("/icon-") ||
    pathname === "/apple-icon.png"
  )
}

function hasValidBasicAuthorization(
  authorization: string | null,
  expectedUsername: string,
  expectedPassword: string,
) {
  if (!authorization?.startsWith("Basic ")) return false

  const encodedCredentials = authorization.slice("Basic ".length).trim()
  if (
    encodedCredentials.length === 0 ||
    encodedCredentials.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedCredentials)
  ) {
    return false
  }

  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString(
    "utf8",
  )
  const separator = decodedCredentials.indexOf(":")
  if (separator < 0) return false

  return validateDeploymentCredentials(
    decodedCredentials.slice(0, separator),
    decodedCredentials.slice(separator + 1),
    expectedUsername,
    expectedPassword,
  )
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

  if (isPublicAuthenticationPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  if (
    hasValidBasicAuthorization(
      request.headers.get("authorization"),
      expectedUsername,
      expectedPassword,
    ) ||
    verifyDeploymentSession(
      request.cookies.get(DEPLOY_SESSION_COOKIE)?.value,
      expectedPassword,
    )
  ) {
    return NextResponse.next()
  }

  if (request.headers.get("accept")?.includes("text/html")) {
    const loginUrl = request.nextUrl.clone()
    const requestedPath = getSafeRedirectPath(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    )
    loginUrl.pathname = "/login"
    loginUrl.search = ""
    loginUrl.searchParams.set("next", requestedPath)
    const response = NextResponse.redirect(loginUrl)
    response.headers.set("Cache-Control", "no-store")
    return response
  }

  return rejectCredentials()
}
