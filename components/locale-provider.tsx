"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { syncDocumentLocale } from "@/lib/i18n/browser"
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale"
import {
  messages as messageCatalogs,
  type MessageCatalog,
} from "@/lib/i18n/messages"

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  messages: MessageCatalog
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: ReactNode
}): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((locale: Locale) => {
    setLocaleState(locale)
    syncDocumentLocale(
      document,
      locale,
      messageCatalogs[locale].metadata,
      LOCALE_COOKIE,
    )
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      messages: messageCatalogs[locale],
    }),
    [locale, setLocale],
  )

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error("useI18n must be used within a LocaleProvider")
  }

  return context
}
