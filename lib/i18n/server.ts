import { cookies, headers } from "next/headers"

import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locale"

export async function getRequestLocale(): Promise<Locale> {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ])

  return resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  )
}
