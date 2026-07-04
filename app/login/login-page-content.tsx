"use client"

import { Cpu, ShieldCheck, Sparkles } from "lucide-react"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useI18n } from "@/components/locale-provider"
import { LoginForm } from "./login-form"

interface LoginPageContentProps {
  nextPath: string
}

export function LoginPageContent({
  nextPath,
}: LoginPageContentProps): React.JSX.Element {
  const { messages } = useI18n()

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
      <div className="absolute right-4 top-4 z-20">
        <LanguageSwitcher />
      </div>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-radial from-primary/5 to-transparent blur-3xl" />
      </div>

      <section className="relative z-10 w-full max-w-[420px] rounded-2xl border border-border/70 bg-card/90 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
            <Cpu className="size-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              {messages.common.productName}
              <Sparkles className="size-4 shrink-0 text-primary" />
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {messages.common.productTagline}
            </p>
          </div>
        </div>

        <div className="mt-7">
          <h2 className="text-xl font-semibold text-foreground">
            {messages.auth.welcomeBack}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {messages.auth.instructions}
          </p>
        </div>

        <LoginForm nextPath={nextPath} />

        <div className="mt-6 flex items-start gap-2 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>{messages.auth.sessionNotice}</p>
        </div>
      </section>
    </main>
  )
}
