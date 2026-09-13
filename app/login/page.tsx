import { cookies } from "next/headers"
import { DEPLOY_SESSION_COOKIE, getDeploymentLoginStage, getSafeRedirectPath } from "@/lib/deployment-auth.mjs"
import { LoginPageContent } from "./login-page-content"

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next
  const nextPath = getSafeRedirectPath(requestedNext)
  const cookieStore = await cookies()
  const stage = getDeploymentLoginStage(cookieStore.get(DEPLOY_SESSION_COOKIE)?.value)

  return <LoginPageContent key={stage} nextPath={nextPath} stage={stage} />
}
