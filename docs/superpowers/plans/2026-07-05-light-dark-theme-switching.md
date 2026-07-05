# Light and Dark Theme Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default light theme and a persistent light/dark segmented switcher without changing survey behavior or data.

**Architecture:** Use the existing `next-themes` dependency to own the root `light`/`dark` class and browser persistence. Keep theme differences in global semantic CSS variables, and expose one focused `ThemeSwitcher` component at the three approved UI surfaces.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, next-themes, lucide-react, Node test runner

---

## File map

- Create `components/theme-switcher.tsx`: localized, mounted-safe segmented light/dark control.
- Create `tests/theme-switching.test.mjs`: source-level integration contracts for provider configuration, tokens, switcher behavior, and placement.
- Modify `app/layout.tsx`: install the theme provider at the application root and remove the hard-coded dark class.
- Modify `app/globals.css`: make `:root` the light palette while retaining `.dark` as the current dark palette.
- Modify `lib/i18n/messages.ts`: add matching Chinese and English labels for the theme control.
- Modify `app/login/login-page-content.tsx`: place the switcher beside the language selector.
- Modify `app/page.tsx`: place the switcher in the dashboard header and mode-selection dialog.

### Task 1: Lock the root theme and palette contracts

**Files:**
- Create: `tests/theme-switching.test.mjs`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing root integration tests**

Create `tests/theme-switching.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --test tests/theme-switching.test.mjs
```

Expected: FAIL because `app/layout.tsx` still hard-codes `dark` and `:root` still contains the dark palette.

- [ ] **Step 3: Connect the root ThemeProvider**

Update `app/layout.tsx` imports:

```tsx
import { ThemeProvider } from '@/components/theme-provider'
```

Replace the root JSX with:

```tsx
<html lang={locale} suppressHydrationWarning>
  <body className="font-sans antialiased bg-background text-foreground">
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      <LocaleProvider initialLocale={locale}>
        {children}
        <Analytics />
      </LocaleProvider>
    </ThemeProvider>
  </body>
</html>
```

- [ ] **Step 4: Replace only the default palette with light tokens**

Replace the declarations inside `:root` in `app/globals.css` with:

```css
:root {
  --background: oklch(0.985 0.004 250);
  --foreground: oklch(0.22 0.025 255);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.22 0.025 255);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.22 0.025 255);
  --primary: oklch(0.52 0.17 255);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.96 0.012 250);
  --secondary-foreground: oklch(0.28 0.035 255);
  --muted: oklch(0.96 0.012 250);
  --muted-foreground: oklch(0.52 0.025 255);
  --accent: oklch(0.94 0.03 235);
  --accent-foreground: oklch(0.3 0.08 255);
  --destructive: oklch(0.58 0.22 25);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.9 0.014 250);
  --input: oklch(0.9 0.014 250);
  --ring: oklch(0.58 0.15 250);
  --chart-1: oklch(0.58 0.18 255);
  --chart-2: oklch(0.62 0.15 170);
  --chart-3: oklch(0.72 0.17 75);
  --chart-4: oklch(0.6 0.2 315);
  --chart-5: oklch(0.62 0.2 30);
  --radius: 0.75rem;
  --sidebar: oklch(0.975 0.008 250);
  --sidebar-foreground: oklch(0.22 0.025 255);
  --sidebar-primary: oklch(0.52 0.17 255);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.94 0.03 235);
  --sidebar-accent-foreground: oklch(0.3 0.08 255);
  --sidebar-border: oklch(0.9 0.014 250);
  --sidebar-ring: oklch(0.58 0.15 250);
}
```

Leave the existing `.dark` token block intact. Replace the fixed dark scrollbar colors with theme-aware colors:

```css
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: color-mix(in oklch, var(--muted-foreground) 50%, transparent);
  border-radius: 3px;
}

.scrollbar-thin:hover::-webkit-scrollbar-thumb {
  background-color: var(--muted-foreground);
}
```

- [ ] **Step 5: Run the root theme tests**

Run:

```bash
node --test tests/theme-switching.test.mjs
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit the root integration**

```bash
git add tests/theme-switching.test.mjs app/layout.tsx app/globals.css
git commit -m "feat: add persistent light and dark theme foundation"
```

### Task 2: Build the localized segmented switcher

**Files:**
- Modify: `tests/theme-switching.test.mjs`
- Create: `components/theme-switcher.tsx`
- Modify: `lib/i18n/messages.ts`

- [ ] **Step 1: Add failing switcher and localization tests**

Append to `tests/theme-switching.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the switcher tests and verify they fail**

Run:

```bash
node --test tests/theme-switching.test.mjs
```

Expected: FAIL because the catalog keys and `components/theme-switcher.tsx` do not exist.

- [ ] **Step 3: Add matching message keys**

Add these keys under `common` in the Chinese catalog in `lib/i18n/messages.ts`:

```ts
selectTheme: "选择主题",
lightTheme: "明亮",
darkTheme: "暗色",
```

Add the matching keys under `common` in the English catalog:

```ts
selectTheme: "Select theme",
lightTheme: "Light",
darkTheme: "Dark",
```

- [ ] **Step 4: Create the segmented ThemeSwitcher**

Create `components/theme-switcher.tsx`:

```tsx
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
```

- [ ] **Step 5: Run focused theme and catalog tests**

Run:

```bash
node --test tests/theme-switching.test.mjs tests/i18n.test.mjs
```

Expected: all tests PASS, including the existing catalog shape equality test.

- [ ] **Step 6: Commit the switcher**

```bash
git add tests/theme-switching.test.mjs components/theme-switcher.tsx lib/i18n/messages.ts
git commit -m "feat: add localized theme switcher"
```

### Task 3: Mount the switcher at the approved surfaces

**Files:**
- Modify: `tests/theme-switching.test.mjs`
- Modify: `app/login/login-page-content.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add failing placement tests**

Append to `tests/theme-switching.test.mjs`:

```js
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
```

- [ ] **Step 2: Run placement tests and verify they fail**

Run:

```bash
node --test tests/theme-switching.test.mjs
```

Expected: FAIL because no approved surface imports or renders `ThemeSwitcher`.

- [ ] **Step 3: Add the login-page switcher**

In `app/login/login-page-content.tsx`, import:

```tsx
import { ThemeSwitcher } from "@/components/theme-switcher"
```

Replace the existing top-right language wrapper with:

```tsx
<div className="absolute right-4 top-4 z-20 flex flex-wrap justify-end gap-2">
  <ThemeSwitcher />
  <LanguageSwitcher />
</div>
```

- [ ] **Step 4: Add the dashboard-header switcher**

In `app/page.tsx`, import:

```tsx
import { ThemeSwitcher } from "@/components/theme-switcher"
```

Inside the header's existing right-side controls, render the switcher after the status pill:

```tsx
<ThemeSwitcher />
```

Keep the existing mode and status controls unchanged.

- [ ] **Step 5: Add the mode-dialog switcher**

In `app/page.tsx`, replace the absolutely positioned language-only block inside `AlertDialogContent` with:

```tsx
<div className="mb-5 flex flex-wrap justify-end gap-2">
  <ThemeSwitcher />
  <LanguageSwitcher />
</div>
```

Remove the title's compensating right padding by changing:

```tsx
<AlertDialogTitle className="mb-3 min-h-9 text-lg text-foreground">
```

This keeps both controls in the dialog's upper-right region without overlapping the title at narrow widths.

- [ ] **Step 6: Run placement and existing frontend tests**

Run:

```bash
npm run test:frontend
```

Expected: all frontend tests PASS.

- [ ] **Step 7: Commit the placements**

```bash
git add tests/theme-switching.test.mjs app/login/login-page-content.tsx app/page.tsx
git commit -m "feat: expose theme switching across the app"
```

### Task 4: Verify behavior and visual quality

**Files:**
- Modify only if verification reveals a theme-specific presentation defect in the files already listed above.

- [ ] **Step 1: Run static verification**

Run:

```bash
npm run typecheck
npm run lint
npm run test:frontend
npm run build
```

Expected: every command exits with status 0. If lint reports pre-existing failures, record them separately and confirm no new failures are introduced by the changed files.

- [ ] **Step 2: Verify default and persistence on the login page**

Using `http://127.0.0.1:3000/login?next=%2F`:

1. Clear only the `theme` local-storage key.
2. Reload and confirm `<html>` receives `light`.
3. Confirm the light segment is pressed.
4. Select dark, reload, and confirm `<html>` remains `dark`.
5. Select light again before continuing.

Expected: default is light, manual selection persists, and the control has one clear selected state.

- [ ] **Step 3: Verify authenticated theme continuity**

Sign in with the user-provided local deployment credentials, then:

1. Confirm the mode dialog uses the saved theme.
2. Switch theme from the dialog and confirm no mode is selected as a side effect.
3. Select survey mode.
4. Change a survey-title field, switch theme from the dashboard header, and confirm the field value remains unchanged.

Expected: the theme follows the user through login, dialog, and dashboard without resetting UI or data state.

- [ ] **Step 4: Verify responsive and visual states**

Check login, mode dialog, and dashboard at representative mobile, tablet, and desktop widths in both themes.

Expected:

- No switcher overlap, clipping, or horizontal overflow.
- Text, cards, inputs, borders, disabled states, overlays, and empty states remain readable.
- Dashboard charts and status colors retain their data meaning.
- Theme changes do not cause visible layout shift.

- [ ] **Step 5: Inspect changed-file diff and repository state**

Run:

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors; only unrelated pre-existing untracked IDE files and the visual-companion scratch directory may remain outside the feature commits.
