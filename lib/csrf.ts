export const CSRF_COOKIE = "survey_csrf"

export function readCsrfToken(cookie = globalThis.document?.cookie ?? ""): string | null {
  const prefix = `${CSRF_COOKIE}=`
  const item = cookie
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix))

  if (!item) return null

  try {
    return decodeURIComponent(item.slice(prefix.length))
  } catch {
    return null
  }
}
