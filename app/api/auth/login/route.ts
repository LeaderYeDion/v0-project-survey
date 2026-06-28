import { NextResponse, type NextRequest } from "next/server"
import {
  DEPLOY_SESSION_COOKIE,
  DEPLOY_SESSION_MAX_AGE_SECONDS,
  createDeploymentSession,
  getSafeRedirectPath,
  validateDeploymentCredentials,
} from "@/lib/deployment-auth.mjs"

const noStoreHeaders = { "Cache-Control": "no-store" }

export async function POST(request: NextRequest) {
  const expectedUsername = process.env.DEPLOY_USERNAME
  const expectedPassword = process.env.DEPLOY_PASSWORD
  if (
    process.env.DEPLOY_AUTH_ENABLED !== "true" ||
    !expectedUsername ||
    !expectedPassword
  ) {
    return NextResponse.json(
      { error: "登录服务暂不可用" },
      { status: 503, headers: noStoreHeaders },
    )
  }

  const body: unknown = await request.json().catch(() => null)
  const username =
    body && typeof body === "object" && "username" in body
      ? String(body.username)
      : ""
  const password =
    body && typeof body === "object" && "password" in body
      ? String(body.password)
      : ""
  const requestedNext =
    body && typeof body === "object" && "next" in body
      ? String(body.next)
      : "/"

  if (
    !validateDeploymentCredentials(
      username,
      password,
      expectedUsername,
      expectedPassword,
    )
  ) {
    return NextResponse.json(
      { error: "用户名或密码不正确" },
      { status: 401, headers: noStoreHeaders },
    )
  }

  const redirectTo = getSafeRedirectPath(requestedNext)
  const response = NextResponse.json(
    { ok: true, redirectTo },
    { headers: noStoreHeaders },
  )
  const isHttps =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"

  response.cookies.set(
    DEPLOY_SESSION_COOKIE,
    createDeploymentSession(expectedPassword),
    {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttps,
      path: "/",
      maxAge: DEPLOY_SESSION_MAX_AGE_SECONDS,
    },
  )

  return response
}
