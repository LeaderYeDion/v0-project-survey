export const supportedLocales = ["zh-CN", "en-US"] as const

export type Locale = (typeof supportedLocales)[number]

export const LOCALE_COOKIE = "survey_locale"

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US"
}

export function normalizeLocale(value?: string | null): Locale {
  return value?.trim().toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"
}

export function resolveLocale(
  cookieValue?: string | null,
  acceptLanguage?: string | null,
): Locale {
  return isLocale(cookieValue) ? cookieValue : normalizeLocale(acceptLanguage)
}

export function formatDate(
  locale: Locale,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value))
}

export function formatInteger(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

export function formatDecimal(
  locale: Locale,
  value: number,
  fractionDigits = 1,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatPercentage(
  locale: Locale,
  value: number,
  options?: Omit<Intl.NumberFormatOptions, "style">,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    ...options,
    style: "percent",
  }).format(value)
}
