"use client"

import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"

export function LanguageSwitcher(): React.JSX.Element {
  const { locale, setLocale, messages } = useI18n()

  return (
    <div
      role="group"
      aria-label={messages.common.selectLanguage}
      className="inline-flex rounded-md border bg-background p-0.5"
    >
      <Button
        type="button"
        lang="zh-CN"
        variant={locale === "zh-CN" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={locale === "zh-CN"}
        onClick={() => setLocale("zh-CN")}
      >中文</Button>
      <Button
        type="button"
        lang="en-US"
        variant={locale === "en-US" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={locale === "en-US"}
        onClick={() => setLocale("en-US")}
      >English</Button>
    </div>
  )
}
