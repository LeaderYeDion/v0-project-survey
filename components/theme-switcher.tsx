"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useI18n } from "@/components/locale-provider"
import { cn } from "@/lib/utils"

type ThemeName = "light" | "dark"

export function ThemeSwitcher(): React.JSX.Element {
  const { theme, setTheme } = useTheme()
  const { messages } = useI18n()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const activeTheme: ThemeName | null =
    mounted && theme === "dark" ? "dark" : mounted ? "light" : null

  const optionClass = (name: ThemeName) =>
    cn(
      "flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition",
      activeTheme === name
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    )

  return (
    <div
      role="group"
      aria-label={messages.common.selectTheme}
      className="inline-flex shrink-0 items-center rounded-lg border border-border/60 bg-secondary/60 p-0.5"
    >
      <button
        type="button"
        aria-pressed={activeTheme === "light"}
        disabled={!mounted}
        className={optionClass("light")}
        onClick={() => setTheme("light")}
      >
        <Sun className="size-3.5" />
        <span>{messages.common.lightTheme}</span>
      </button>
      <button
        type="button"
        aria-pressed={activeTheme === "dark"}
        disabled={!mounted}
        className={optionClass("dark")}
        onClick={() => setTheme("dark")}
      >
        <Moon className="size-3.5" />
        <span>{messages.common.darkTheme}</span>
      </button>
    </div>
  )
}
