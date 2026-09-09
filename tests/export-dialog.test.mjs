import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

async function loadSurveyApi() {
  const source = readFileSync("lib/survey-api.ts", "utf8")
    .replace('export * from "./survey-contract"', "")
    .replace(
      /import \{ readCsrfToken \} from "\.\/csrf"\s*/,
      "const readCsrfToken = () => 'csrf-token'\n",
    )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  )
}

test("export dialog offers exact scopes and a filename input", () => {
  const source = readFileSync("components/export-dialog.tsx", "utf8")

  for (const scope of ["full", "filtered", "exceptions"]) {
    assert.match(source, new RegExp(`value=[{]?['\"]${scope}['\"]`))
  }
  assert.match(source, /name="filename"/)
  assert.match(source, /disabled=\{[^}]*filtered[^}]*filters/)
})

test("filtered export sends current filters and returns the server filename", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  const originalDocument = globalThis.document
  let captured
  globalThis.document = { cookie: "survey_csrf=csrf-token" }
  globalThis.fetch = async (url, init) => {
    captured = { url, init }
    return new Response("respondent_id\nrespondent-1\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=research-round.csv; filename*=UTF-8''%E7%AD%9B%E9%80%89%E7%BB%93%E6%9E%9C.csv",
        "X-Export-Record-Id": "export-1",
      },
    })
  }

  try {
    const result = await api.apiExportRound("zh-CN", "round-1", {
      format: "csv",
      scope: "filtered",
      filename: "筛选结果",
      filters: { city: "杭州" },
    })
    assert.equal(captured.url, "/survey-api/rounds/round-1/exports")
    assert.deepEqual(JSON.parse(captured.init.body), {
      format: "csv",
      scope: "filtered",
      filename: "筛选结果",
      filters: { city: "杭州" },
    })
    assert.equal(result.filename, "筛选结果.csv")
    assert.equal(result.recordId, "export-1")
    assert.equal(await result.blob.text(), "respondent_id\nrespondent-1\n")
  } finally {
    globalThis.fetch = originalFetch
    globalThis.document = originalDocument
  }
})

test("round export records use the owner-scoped list endpoint", async () => {
  const api = await loadSurveyApi()
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url, init }
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    assert.deepEqual(await api.apiListRoundExports("en-US", "round-9"), [])
    assert.equal(captured.url, "/survey-api/rounds/round-9/exports")
    assert.equal(captured.init.method, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
