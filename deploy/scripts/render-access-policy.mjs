#!/usr/bin/env node

import { readFile } from "node:fs/promises"

const [, , allowlistPath, otpIdentityProviderId] = process.argv

function fail(message) {
  console.error(`Access policy error: ${message}`)
  process.exit(1)
}

if (!allowlistPath) {
  fail("allowlist path is required")
}

if (!otpIdentityProviderId?.trim()) {
  fail("OTP identity provider ID is required")
}

let contents
try {
  contents = await readFile(allowlistPath, "utf8")
} catch {
  fail("cannot read allowlist file")
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emails = [
  ...new Set(
    contents
      .split(/\r?\n/)
      .map(line => line.replace(/#.*$/, "").trim().toLowerCase())
      .filter(Boolean),
  ),
].sort()

if (emails.length === 0) {
  fail("allowlist must contain at least one email")
}

const invalidEmail = emails.find(email => !emailPattern.test(email))
if (invalidEmail) {
  fail(`invalid email: ${invalidEmail}`)
}

const policy = {
  name: "Local survey email allowlist",
  decision: "allow",
  precedence: 1,
  include: emails.map(email => ({ email: { email } })),
  exclude: [],
  require: [
    {
      login_method: {
        id: otpIdentityProviderId.trim(),
      },
    },
  ],
}

process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`)
