import test from "node:test"
import assert from "node:assert/strict"
import {
  MOBILE_BREAKPOINT,
  DESKTOP_BREAKPOINT,
  getResponsiveLayout,
} from "../lib/responsive-layout.mjs"

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
