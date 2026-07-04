import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  formatDate,
  formatInteger,
  formatPercentage,
  normalizeLocale,
  resolveLocale,
} from "../lib/i18n/locale.ts"
import { messages } from "../lib/i18n/messages.ts"

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8")

test("normalizes supported and language-family locale values", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh-CN")
  assert.equal(normalizeLocale("zh-TW,zh;q=0.9"), "zh-CN")
  assert.equal(normalizeLocale("en-GB,en;q=0.9"), "en-US")
})

test("prefers a valid locale cookie and otherwise normalizes the header", () => {
  assert.equal(resolveLocale("en-US", "zh-CN"), "en-US")
  assert.equal(resolveLocale("invalid", "zh-CN"), "zh-CN")
  assert.equal(resolveLocale(undefined, "fr-FR"), "en-US")
})

test("formats dates deterministically for both locales", () => {
  const timestamp = "2024-01-02T15:04:05Z"
  const options = {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }

  assert.equal(formatDate("zh-CN", timestamp, options), "2024/01/02")
  assert.equal(formatDate("en-US", timestamp, options), "01/02/2024")
})

test("formats grouped integers for both locales", () => {
  assert.equal(formatInteger("zh-CN", 1_234_567), "1,234,567")
  assert.equal(formatInteger("en-US", 1_234_567), "1,234,567")
})

test("formats ratio inputs as percentages for both locales", () => {
  assert.equal(formatPercentage("zh-CN", 0.625), "63%")
  assert.equal(formatPercentage("en-US", 0.625), "63%")
})

test("percentage formatting cannot be changed to a non-percent style", () => {
  assert.equal(
    formatPercentage("en-US", 0.625, { style: "decimal" }),
    "63%",
  )
})

function assertMatchingMessageShape(reference, candidate, path = "messages") {
  assert.equal(
    typeof candidate,
    typeof reference,
    `${path} must have the same value type`,
  )

  if (typeof reference === "function") {
    return
  }

  if (reference && typeof reference === "object") {
    assert.deepEqual(
      Object.keys(candidate).sort(),
      Object.keys(reference).sort(),
      `${path} must have the same nested keys`,
    )
    for (const key of Object.keys(reference)) {
      assertMatchingMessageShape(reference[key], candidate[key], `${path}.${key}`)
    }
  }
}

test("Chinese and English catalogs have matching nested keys and functions", () => {
  assertMatchingMessageShape(messages["zh-CN"], messages["en-US"])
})

test("dynamic catalog messages compose already-formatted values", () => {
  assert.equal(messages["zh-CN"].survey.completionRate("63%"), "完成率约 63%")
  assert.equal(
    messages["en-US"].survey.completionRate("63%"),
    "Completion rate: 63%",
  )
  assert.equal(
    messages["zh-CN"].interview.respondentSummary(10, 4),
    "10 位受访者 / 4 已完成",
  )
  assert.equal(messages["en-US"].survey.responsePosition(2, 8), "2 of 8")
  assert.equal(
    messages["en-US"].analytics.filteredRespondents(3, 10),
    "Showing 3 of 10 respondents",
  )
  assert.equal(messages["zh-CN"].analytics.groupCount(2), "2 个分组")
  assert.equal(
    messages["en-US"].interview.questionProgress(3, "-"),
    "Question progress: 3 / -",
  )
})

test("server locale resolution awaits cookies and headers together", async () => {
  const source = await readSource("../lib/i18n/server.ts")

  assert.match(source, /await Promise\.all\(\[\s*cookies\(\),\s*headers\(\),?\s*\]\)/)
  assert.match(source, /resolveLocale\(/)
  assert.match(source, /cookieStore\.get\(LOCALE_COOKIE\)\?\.value/)
  assert.match(source, /requestHeaders\.get\(["']accept-language["']\)/)
})

test("root layout synchronizes the resolved locale with html and the provider", async () => {
  const source = await readSource("../app/layout.tsx")

  assert.match(source, /export default async function RootLayout/)
  assert.match(source, /const locale = await getRequestLocale\(\)/)
  assert.match(source, /<html lang=\{locale\}/)
  assert.match(source, /<LocaleProvider initialLocale=\{locale\}>/)
})

test("localized metadata comes from the resolved message catalog", async () => {
  const source = await readSource("../app/layout.tsx")

  assert.match(source, /export async function generateMetadata/)
  assert.match(source, /messages\[locale\]\.metadata/)
})

test("locale provider persists locale changes and keeps html synchronized", async () => {
  const source = await readSource("../components/locale-provider.tsx")

  assert.match(source, /setLocaleState\(locale\)/)
  assert.match(source, /document\.documentElement\.lang = locale/)
  assert.match(
    source,
    /`\$\{LOCALE_COOKIE\}=\$\{locale\}; Path=\/; Max-Age=31536000; SameSite=Lax`/,
  )
})

test("language switcher exposes both language options with a catalog label", async () => {
  const source = await readSource("../components/language-switcher.tsx")

  assert.match(source, /\{\s*locale: "zh-CN", label: "中文"\s*\}/)
  assert.match(source, /\{\s*locale: "en-US", label: "English"\s*\}/)
  assert.match(source, /aria-label=\{messages\./)
})
