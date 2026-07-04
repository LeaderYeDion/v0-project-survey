import { getSafeRedirectPath } from "@/lib/deployment-auth.mjs"
import { LoginPageContent } from "./login-page-content"

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const requestedNext = Array.isArray(params.next) ? params.next[0] : params.next
  const nextPath = getSafeRedirectPath(requestedNext)

  return <LoginPageContent nextPath={nextPath} />
}
