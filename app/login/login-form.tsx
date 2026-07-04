"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogIn } from "lucide-react"
import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getVisibleLoginError,
  isCurrentLoginRequest,
  type LoginErrorState,
  type LoginRequestToken,
} from "./login-error-state"

interface LoginFormProps {
  nextPath: string
}

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter()
  const { locale, messages } = useI18n()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<LoginErrorState | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const currentLocaleRef = useRef(locale)
  const previousLocaleRef = useRef(locale)
  const requestEpoch = useRef(0)
  currentLocaleRef.current = locale
  const visibleError = getVisibleLoginError(error, locale)

  useEffect(() => {
    if (previousLocaleRef.current === locale) return

    previousLocaleRef.current = locale
    requestEpoch.current += 1
    setError(null)
    setIsSubmitting(false)
  }, [locale])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError(null)
    setIsSubmitting(true)
    requestEpoch.current += 1
    const request: LoginRequestToken = {
      locale,
      epoch: requestEpoch.current,
    }

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": locale,
        },
        body: JSON.stringify({ username, password, next: nextPath }),
      })
      const result: { error?: string; redirectTo?: string } =
        await response.json()

      if (
        !isCurrentLoginRequest(
          request,
          currentLocaleRef.current,
          requestEpoch.current,
        )
      ) {
        return
      }

      if (!response.ok || !result.redirectTo) {
        setError({
          locale: request.locale,
          message: result.error || messages.auth.loginFailed,
        })
        return
      }

      router.replace(result.redirectTo)
      router.refresh()
    } catch {
      if (
        isCurrentLoginRequest(
          request,
          currentLocaleRef.current,
          requestEpoch.current,
        )
      ) {
        setError({
          locale: request.locale,
          message: messages.auth.serviceUnavailable,
        })
      }
    } finally {
      if (
        isCurrentLoginRequest(
          request,
          currentLocaleRef.current,
          requestEpoch.current,
        )
      ) {
        setIsSubmitting(false)
      }
    }
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="username">{messages.auth.username}</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={event => setUsername(event.target.value)}
          placeholder={messages.auth.usernamePlaceholder}
          required
          disabled={isSubmitting}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{messages.auth.password}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder={messages.auth.passwordPlaceholder}
          required
          disabled={isSubmitting}
        />
      </div>

      {visibleError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
        >
          {visibleError}
        </p>
      )}

      <Button
        type="submit"
        className="h-11 w-full"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogIn className="size-4" />
        )}
        {isSubmitting ? messages.auth.signingIn : messages.auth.signIn}
      </Button>
    </form>
  )
}
