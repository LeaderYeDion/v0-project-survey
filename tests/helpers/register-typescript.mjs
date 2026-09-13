import { registerHooks } from "node:module"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = new URL("../../", import.meta.url)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server" || specifier === "next/navigation") {
      return nextResolve(`${specifier}.js`, context)
    }
    const target = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), root)
      : specifier.startsWith(".") && context.parentURL?.startsWith(root.href)
        ? new URL(specifier, context.parentURL)
        : null
    if (target && !target.pathname.includes("/node_modules/")) {
      for (const suffix of ["", ".ts", ".tsx", ".mjs"]) {
        if (existsSync(fileURLToPath(`${target.href}${suffix}`))) {
          return nextResolve(`${target.href}${suffix}`, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      }
    }
    return nextLoad(url, context)
  },
})
