import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeLocale,
  resolveLocale,
} from "../lib/i18n/locale.ts"
import { messages } from "../lib/i18n/messages.ts"

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

function assertMatchingMessageShape(reference, candidate, path = "messages") {
  assert.equal(
    typeof candidate,
    typeof reference,
    `${path} must have the same value type`,
  )

  if (typeof reference === "function") {
    assert.equal(
      candidate.length,
      reference.length,
      `${path} must have the same parameter count`,
    )
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
