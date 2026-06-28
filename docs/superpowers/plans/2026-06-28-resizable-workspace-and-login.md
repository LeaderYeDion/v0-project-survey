# Resizable Workspace and Login Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add adjustable desktop workspace columns and replace browser-native login prompts with a branded login page without breaking Quick Tunnel deployment checks.

**Architecture:** A focused deployment-auth module owns constant-time credential checks, signed 12-hour sessions, and safe redirects. The proxy accepts either the new session Cookie or existing Basic Authorization used by deployment probes; HTML navigations redirect to a public login route. Desktop layout uses the repository's existing resizable panel primitives while tablet and mobile layouts remain unchanged.

**Tech Stack:** Next.js 16 App Router and Proxy, React 19, TypeScript, Node crypto/test runner, react-resizable-panels, Tailwind CSS, in-app Browser

---

### Task 1: Define signed deployment session behavior

**Files:**
- Create: `lib/deployment-auth.mjs`
- Modify: `deploy/tests/basic-auth.test.mjs`

- [x] Write failing tests for constant-time credential validation, session creation/verification, expiration, tampering, password rotation, and rejection of unsafe redirect targets.
- [x] Run `node --test deploy/tests/basic-auth.test.mjs` and confirm failures reference missing exports from `lib/deployment-auth.mjs`.
- [x] Implement `validateDeploymentCredentials`, `createDeploymentSession`, `verifyDeploymentSession`, `getSafeRedirectPath`, `DEPLOY_SESSION_COOKIE`, and `DEPLOY_SESSION_MAX_AGE_SECONDS` using HMAC-SHA256 and a 12-hour TTL.
- [x] Re-run the focused test and confirm all auth-helper cases pass.

### Task 2: Redirect browser navigation to the login page

**Files:**
- Modify: `proxy.ts`
- Modify: `deploy/tests/basic-auth.test.mjs`

- [x] Add failing Proxy tests showing that unauthenticated HTML navigation redirects to `/login`, valid session Cookies pass, login/static paths are public, non-HTML requests still receive `401`, and valid Basic Authorization remains accepted.
- [x] Run the focused test and confirm the new Proxy cases fail against the current challenge-only behavior.
- [x] Refactor `proxy.ts` to use the auth helpers, classify public/login paths, verify the session Cookie, redirect HTML navigation, and preserve fail-closed and Basic Auth probe behavior.
- [x] Re-run the focused test and confirm all Proxy behavior passes.

### Task 3: Build the branded login route

**Files:**
- Create: `app/api/auth/login/route.ts`
- Create: `app/login/page.tsx`
- Create: `app/login/login-form.tsx`
- Modify: `deploy/tests/deployment-contract.test.mjs`

- [x] Add failing deployment contract tests for the login route/page files, secure Cookie attributes, generic invalid-credential response, and use of a sanitized redirect.
- [x] Run `node --test deploy/tests/deployment-contract.test.mjs` and confirm the new file/contract assertions fail.
- [x] Implement the POST route with JSON validation, constant-time credential comparison, a signed HttpOnly SameSite=Strict Cookie, and no-store responses.
- [x] Implement a centered responsive login page using the application's dark gradient/card language, labeled username/password inputs, loading state, generic failure feedback, and safe post-login navigation.
- [x] Re-run the deployment contract tests and `npx tsc --noEmit`.

### Task 4: Add adjustable desktop panels

**Files:**
- Create: `lib/workspace-layout.mjs`
- Create: `tests/workspace-layout.test.mjs`
- Modify: `app/page.tsx`
- Modify: `components/ui/resizable.tsx`

- [x] Add failing tests for default proportions `24/52/24`, side minimum/maximum `18/40`, center minimum `34`, and valid total proportions.
- [x] Run `node --test tests/workspace-layout.test.mjs` and confirm it fails because the layout module does not exist.
- [x] Implement the layout constants and make resize handles visually discoverable on hover/focus while retaining primitive keyboard behavior.
- [x] Replace only the desktop fixed-width asides with `ResizablePanelGroup`, three panels, two labeled resize handles, and a stable `autoSaveId`.
- [x] Re-run the layout tests and `npx tsc --noEmit`.

### Task 5: Synchronize live documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`
- Modify: `deploy/README.md`
- Modify: `deploy/ARCHITECTURE.md`
- Modify: `deploy/RUNBOOK.md`
- Modify: `deploy/SECURITY.md`
- Modify: `deploy/TROUBLESHOOTING.md`

- [x] Update workspace documentation from fixed desktop widths to adjustable remembered proportions.
- [x] Replace browser-native Basic Auth instructions with login-page/Cookie behavior while documenting Basic Authorization as a deployment-probe compatibility path.
- [x] Record scope, verification evidence, remaining single-account limitations, and unchanged survey business flow in the iteration log.
- [x] Run `rg -n "原生账号密码|原生登录框|浏览器原生 Basic Auth|固定为 340" README.md docs deploy` and resolve stale live-document claims while preserving superseded historical specs.

### Task 6: Full verification

**Files:**
- Verify all modified files.

- [x] Run `node --test tests/*.test.mjs deploy/tests/*.test.mjs`.
- [x] Run `npx tsc --noEmit`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Use Browser with authentication enabled to verify failed/successful login, safe redirect, mode selection, desktop resizing and persistence.
- [x] Use Browser at 390, 768, 1024, 1200, and 1440 px to verify no document overflow and unchanged mobile/tablet navigation.
- [x] Review Browser console errors and the final diff; do not include `.idea/` or unrelated user changes.
