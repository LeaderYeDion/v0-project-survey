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
  transitionLocale,
  type LocaleState,
} from "@/lib/i18n/locale-lock"
import {
  messages as messageCatalogs,
  type MessageCatalog,
} from "@/lib/i18n/messages"

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  isLocaleLocked: boolean
  lockLocale: () => void
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
  const [localeState, setLocaleState] = useState<LocaleState>({
    locale: initialLocale,
    locked: false,
  })

  const setLocale = useCallback((locale: Locale) => {
    setLocaleState(current => {
      const next = transitionLocale(current, { type: "set", locale })
      if (next.locale !== current.locale) {
        syncDocumentLocale(
          document,
          next.locale,
          messageCatalogs[next.locale].metadata,
          LOCALE_COOKIE,
        )
      }
      return next
    })
  }, [])

  const lockLocale = useCallback(() => {
    setLocaleState(current => transitionLocale(current, { type: "lock" }))
  }, [])

  const { locale, locked: isLocaleLocked } = localeState
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      isLocaleLocked,
      lockLocale,
      messages: messageCatalogs[locale],
    }),
    [isLocaleLocked, locale, lockLocale, setLocale],
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
