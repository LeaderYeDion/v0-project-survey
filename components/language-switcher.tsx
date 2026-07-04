"use client"

import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import type { Locale } from "@/lib/i18n/locale"

const options: ReadonlyArray<{ locale: Locale; label: string }> = [
  { locale: "zh-CN", label: "中文" },
  { locale: "en-US", label: "English" },
]

export function LanguageSwitcher(): React.JSX.Element {
  const { locale, setLocale, messages } = useI18n()

  return (
    <div
      role="group"
      aria-label={messages.common.productName}
      className="inline-flex rounded-md border bg-background p-0.5"
    >
      {options.map((option) => (
        <Button
          key={option.locale}
          type="button"
          variant={locale === option.locale ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={locale === option.locale}
          onClick={() => setLocale(option.locale)}
        >{option.label}</Button>
      ))}
    </div>
  )
}
