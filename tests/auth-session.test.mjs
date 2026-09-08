import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("application login uses the backend session instead of deployment identity", () => {
  const form = readFileSync("app/login/login-form.tsx", "utf8")
  assert.match(form, /apiLogin\(locale/)
  assert.match(form, /router\.replace\(nextPath\)/)
  assert.doesNotMatch(form, /fetch\("\/api\/auth\/login"/)
  assert.doesNotMatch(form, /localStorage|sessionStorage/)
})

test("AuthSessionProvider owns me, logout, and session-expiry navigation", () => {
  const source = readFileSync("components/auth-session-provider.tsx", "utf8")
  assert.match(source, /apiMe\(locale/)
  assert.match(source, /apiLogout\(locale\)/)
  assert.match(source, /onAuthSessionExpired/)
  assert.match(source, /setUser\(null\)/)
  assert.match(source, /router\.replace\("\/login"\)/)
  assert.match(source, /status:\s*"loading"\s*\|\s*"authenticated"\s*\|\s*"unauthenticated"/)
})

test("application session is reloaded after login navigation", () => {
  const source = readFileSync("components/auth-session-provider.tsx", "utf8")
  assert.match(source, /usePathname/)
  assert.match(source, /\[[^\]]*pathname[^\]]*\]/)
})

test("root layout installs the application session boundary", () => {
  const source = readFileSync("app/layout.tsx", "utf8")
  assert.match(source, /AuthSessionProvider/)
  assert.match(source, /<AuthSessionProvider>/)
})

test("outer deployment auth is disabled unless explicitly enabled", () => {
  const source = readFileSync("proxy.ts", "utf8")
  assert.match(source, /process\.env\.DEPLOY_AUTH_ENABLED !== "true"/)
  assert.match(source, /return NextResponse\.next\(\)/)
  assert.doesNotMatch(source, /survey_session.*DEPLOY_SESSION_COOKIE|DEPLOY_SESSION_COOKIE.*survey_session/s)
})
