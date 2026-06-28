import { Cpu, ShieldCheck, Sparkles } from "lucide-react"
import { LoginForm } from "./login-form"
import { getSafeRedirectPath } from "@/lib/deployment-auth.mjs"

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next
  const nextPath = getSafeRedirectPath(requestedNext)

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background p-4">
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
              Survey Agent Simulator
              <Sparkles className="size-4 shrink-0 text-primary" />
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 调研代理模拟平台
            </p>
          </div>
        </div>

        <div className="mt-7">
          <h2 className="text-xl font-semibold text-foreground">欢迎回来</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            使用部署者提供的共享账号和密码登录，然后继续选择问卷或访谈模式。
          </p>
        </div>

        <LoginForm nextPath={nextPath} />

        <div className="mt-6 flex items-start gap-2 border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>登录会话仅保存在当前浏览器，并将在 12 小时后失效。</p>
        </div>
      </section>
    </main>
  )
}
