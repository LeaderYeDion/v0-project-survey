import type { Locale } from "@/lib/i18n/locale"

export interface LoginErrorState {
  locale: Locale
  message: string
}

export interface LoginRequestToken {
  locale: Locale
  epoch: number
}

export function getVisibleLoginError(
  error: LoginErrorState | null,
  locale: Locale,
): string | null {
  return error?.locale === locale ? error.message : null
}

export function isCurrentLoginRequest(
  request: LoginRequestToken,
  locale: Locale,
  epoch: number,
): boolean {
  return request.locale === locale && request.epoch === epoch
}
