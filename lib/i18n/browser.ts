import type { Locale } from "./locale"

export interface LocaleDocument {
  documentElement: {
    lang: string
  }
  cookie: string
  title: string
  querySelector(selectors: string): {
    setAttribute(name: string, value: string): void
  } | null
}

export interface DocumentMetadata {
  title: string
  description: string
}

export function syncDocumentLocale(
  target: LocaleDocument,
  locale: Locale,
  metadata: DocumentMetadata,
  localeCookie: string,
): void {
  target.documentElement.lang = locale
  target.cookie =
    `${localeCookie}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
  target.title = metadata.title
  target
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", metadata.description)
}
