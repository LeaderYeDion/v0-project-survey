"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { useI18n } from "@/components/locale-provider"
import {
  apiLogout,
  apiMe,
  onAuthSessionExpired,
  SurveyApiError,
  type CurrentUser,
} from "@/lib/survey-api"

export interface AuthSessionContextValue {
  user: CurrentUser | null
  status: "loading" | "authenticated" | "unauthenticated"
  logout: () => Promise<void>
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null)

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, setLocale } = useI18n()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthSessionContextValue["status"]>("loading")

  const expireSession = useCallback(() => {
    setUser(null)
    setStatus("unauthenticated")
    router.replace("/login")
    router.refresh()
  }, [router])

  useEffect(() => onAuthSessionExpired(expireSession), [expireSession])

  useEffect(() => {
    if (pathname === "/login") {
      setUser(null)
      setStatus("unauthenticated")
      return
    }
    const controller = new AbortController()
    setStatus("loading")
    apiMe(locale, controller.signal)
      .then(currentUser => {
        if (controller.signal.aborted) return
        setUser(currentUser)
        setStatus("authenticated")
        if (currentUser.locale !== locale) setLocale(currentUser.locale)
      })
      .catch(error => {
        if (controller.signal.aborted) return
        if (!(error instanceof SurveyApiError) || error.code !== "AUTH_SESSION_EXPIRED") {
          setUser(null)
          setStatus("unauthenticated")
        }
      })
    return () => controller.abort()
  }, [locale, pathname, setLocale])

  const logout = useCallback(async () => {
    try {
      await apiLogout(locale)
    } finally {
      expireSession()
    }
  }, [expireSession, locale])

  const value = useMemo<AuthSessionContextValue>(
    () => ({ user, status, logout }),
    [logout, status, user],
  )

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  )
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext)
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider")
  }
  return context
}
