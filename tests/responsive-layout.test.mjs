import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import {
  MOBILE_BREAKPOINT,
  DESKTOP_BREAKPOINT,
  getResponsiveLayout,
} from "../lib/responsive-layout.mjs"

const readSource = path => readFile(new URL(path, import.meta.url), "utf8")

test("uses mobile layout below 768px", () => {
  assert.equal(MOBILE_BREAKPOINT, 768)
  assert.equal(getResponsiveLayout(390), "mobile")
  assert.equal(getResponsiveLayout(767), "mobile")
})

test("uses tablet layout from 768px through 1199px", () => {
  assert.equal(getResponsiveLayout(768), "tablet")
  assert.equal(getResponsiveLayout(1024), "tablet")
  assert.equal(getResponsiveLayout(1199), "tablet")
})

test("uses desktop layout from 1200px", () => {
  assert.equal(DESKTOP_BREAKPOINT, 1200)
  assert.equal(getResponsiveLayout(1200), "desktop")
  assert.equal(getResponsiveLayout(1440), "desktop")
})

test("bulk response detail header stacks on mobile without shrinking its controls", async () => {
  const source = await readSource("../components/bulk-survey-panel.tsx")

  assert.match(
    source,
    /className="mb-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"/,
  )
  assert.match(
    source,
    /className="flex min-w-0 items-center gap-2"[\s\S]*?messages\.survey\.responseDetails/,
  )
  assert.match(
    source,
    /className="flex shrink-0 items-center gap-2 self-end sm:self-auto"/,
  )
})

test("chat footer wraps long localized statistics without clipping status", async () => {
  const source = await readSource("../components/chat-simulation-panel.tsx")

  assert.match(
    source,
    /className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground sm:justify-between"/,
  )
  assert.match(
    source,
    /<span className="min-w-0">[\s\S]*?messages\.interview\.questionProgress/,
  )
  assert.match(
    source,
    /<span className="shrink-0">[\s\S]*?messages\.interview\.status/,
  )
})
