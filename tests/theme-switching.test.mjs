import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { messages } from "../lib/i18n/messages.ts"

const readSource = path => readFile(new URL(path, import.meta.url), "utf8")

test("root layout installs a persistent class-based light theme", async () => {
  const source = await readSource("../app/layout.tsx")

  assert.match(source, /<html lang=\{locale\} suppressHydrationWarning>/)
  assert.doesNotMatch(source, /className=["']dark["']/)
  assert.match(source, /<ThemeProvider/)
  assert.match(source, /attribute=["']class["']/)
  assert.match(source, /defaultTheme=["']light["']/)
  assert.match(source, /enableSystem=\{false\}/)
  assert.match(source, /disableTransitionOnChange/)
})

test("global tokens define distinct default light and dark palettes", async () => {
  const source = await readSource("../app/globals.css")
  const rootStart = source.indexOf(":root {")
  const darkStart = source.indexOf(".dark {")
  const rootTokens = source.slice(rootStart, darkStart)
  const darkTokens = source.slice(darkStart, source.indexOf("@theme inline"))

  assert.ok(rootStart >= 0)
  assert.ok(darkStart > rootStart)
  assert.match(rootTokens, /--background:\s*oklch\(0\.985/)
  assert.match(rootTokens, /--card:\s*oklch\(1 0 0\)/)
  assert.match(rootTokens, /--foreground:\s*oklch\(0\.22/)
  assert.match(darkTokens, /--background:\s*oklch\(0\.12/)
  assert.match(darkTokens, /--foreground:\s*oklch\(0\.95/)
  assert.notEqual(rootTokens, darkTokens)
})

test("theme catalogs provide matching localized switcher labels", () => {
  assert.equal(messages["zh-CN"].common.selectTheme, "选择主题")
  assert.equal(messages["zh-CN"].common.lightTheme, "明亮")
  assert.equal(messages["zh-CN"].common.darkTheme, "暗色")
  assert.equal(messages["en-US"].common.selectTheme, "Select theme")
  assert.equal(messages["en-US"].common.lightTheme, "Light")
  assert.equal(messages["en-US"].common.darkTheme, "Dark")
})

test("theme switcher is mounted-safe and exposes two pressed buttons", async () => {
  const source = await readSource("../components/theme-switcher.tsx")

  assert.match(source, /useTheme\(\)/)
  assert.match(source, /setTheme\("light"\)/)
  assert.match(source, /setTheme\("dark"\)/)
  assert.match(source, /aria-label=\{messages\.common\.selectTheme\}/)
  assert.match(source, /aria-pressed=\{activeTheme === "light"\}/)
  assert.match(source, /aria-pressed=\{activeTheme === "dark"\}/)
  assert.match(source, /disabled=\{!mounted\}/)
})

test("theme switcher appears on login and both dashboard surfaces", async () => {
  const loginSource = await readSource("../app/login/login-page-content.tsx")
  const dashboardSource = await readSource("../app/page.tsx")
  const dashboardInstances =
    dashboardSource.match(/<ThemeSwitcher\s*\/>/g) ?? []

  assert.match(loginSource, /import \{ ThemeSwitcher \}/)
  assert.match(loginSource, /<ThemeSwitcher\s*\/>/)
  assert.match(dashboardSource, /import \{ ThemeSwitcher \}/)
  assert.equal(dashboardInstances.length, 2)
})
