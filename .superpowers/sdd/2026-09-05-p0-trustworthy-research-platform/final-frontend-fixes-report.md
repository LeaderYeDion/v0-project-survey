# Final frontend/auth remediation — 2026-09-13

## Scope and commit

- Base: `3188be2` on `real-backend-v1`; the resumed checkout was clean. Existing backend commits were preserved. No worktree or subagents were used.
- Implementation: `c80d8f6` — `fix: separate deployment login and guard frontend resource state`.
- Addressed the parent's final reviewer findings against the approved P0 design, current proxy/login/API contracts, and the final backend remediation report.

## Changes

1. With `DEPLOY_AUTH_ENABLED=true`, `/login` selects the deployment stage on the server unless its signed deployment cookie verifies. The first form explicitly calls `/api/auth/login`; successful navigation refreshes `/login` into the research-account stage and remounts the form to clear both credential fields. The second form calls `/survey-api/auth/login`. Default-off deployment auth goes directly to the research-account form. Deployment credentials, signing secrets and cookie tokens remain server-side; the outer login client returns `void`, never `CurrentUser`.
2. The app-session provider does not call `/auth/me` on the public login page. Application identity is loaded after application login navigation. API requests blocked by an expired/missing outer cookie return `DEPLOY_AUTH_REQUIRED` and notify the session navigation boundary. Deployment credential/service errors use `{code, message, details}`. Existing same-origin `next` sanitization and protected cookie attributes are preserved.
3. Added the backend's exact `CSRF_INVALID` code to both frontend error catalogs. This code remains an actionable error and does not expire the application identity. No `AUTH_CSRF_INVALID` references remain in app/components/lib/tests (the previous frontend catalogs lacked a CSRF entry).
4. Project-list, questionnaire-list and questionnaire-detail effects each own an AbortController via `createEffectRequestTracker`, return cancellation cleanup, and check request generation plus the current user/locale/resource identity on success and rejection. Questionnaire-list selection uses the current selection ref, and project switches clear the previous questionnaire options. Aborted old API failures cannot notify a new session's expiry boundary.
5. Header history status, chat active respondent/running state, configuration/results and analytics running state derive from the displayed round. A terminal history snapshot no longer inherits the current round's running indicator or active respondent. Current-round polling and start gating keep their independent state.

## TDD and behavior evidence

- Auth request/proxy/render RED: **4 failed, 1 passed**. Failures established missing deployment UI, missing verified-cookie stage selection/client, and the previous unstructured deployment error. A test-loader setup failure occurred before this valid RED run and was corrected without production changes.
- Auth focused GREEN including existing deployment auth contracts: **17 passed**.
- Real browser auth RED: **1 failed, 1 passed**. Enabled deployment auth could not show the deployment-access step; default-off direct application login passed.
- Browser auth GREEN: **2 passed**. A subsequent test assertion initially selected Next's empty route-announcer alert; narrowing it to the visible credential error fixed the test harness. The browser verifies invalid outer credentials do not set a cookie, outer success sets only the deployment cookie, credential inputs are cleared for the app step, app identity comes from `/auth/me`, the original local query is restored, and hostile external `next` is normalized.
- Effect/history/API RED: **10 failed, 26 passed**. Failures establish absent generation/identity cancellation behavior and independent display derivation, missing CSRF localization, missing deployment-expiry handling and stale aborted auth failures notifying the current boundary.
- Additional list/detail/copy tests cover stale rejected outcomes, same-kind replacement for both success/failure, and invalidation. These **9 coverage-only cases passed initially** against the existing generic guard; no production change was needed for them.
- Mounted project-switch RED: **2 failed, 2 passed** across the browser suite. A deliberately delayed old response changed the displayed selection from `Questionnaire B` to `Questionnaire A`; a delayed old failure displayed an obsolete resource error. An initial accessible-label typo was corrected before the valid RED run.
- Effect/history/API focused GREEN: **36 passed**.
- Mounted browser final GREEN: **4 passed, 0 failed** (~9 seconds). This suite runs real Next routes/proxy/UI and Chrome with a local HTTP backend fixture that replaces PostgreSQL. Delayed-response tests deliberately use a transport that ignores abort to exercise stale-result suppression. The enabled auth case also checks that there are no browser `pageerror` events. These are not Docker/PostgreSQL or five-viewport acceptance claims.

## Final verification

```text
npm run test:frontend
138 passed, 0 failed

node --test deploy/tests/*.test.mjs
44 passed, 0 failed

npm run typecheck
exit 0 (also rerun after production build)

PLAYWRIGHT_MODULE=/Users/mymac/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs \
  node --test tests/browser/login-flow.test.mjs
4 passed, 0 failed

npm run build
exit 0; compiled in 2.9 seconds; 5/5 static pages generated

git diff --check
exit 0
```

The browser suite can also resolve a normally installed `playwright` package when `PLAYWRIGHT_MODULE` is unset; it requires installed Google Chrome (`channel: "chrome"`). It starts and closes its own loopback Next/fixture servers and isolated browser contexts. No project dependency or lockfile was changed to reuse the locally available runtime.

The restricted-environment browser attempt failed with loopback `listen EPERM`; the unchanged test command ran successfully with approved local process/browser access. The first sandbox production build stalled in Turbopack compilation and was stopped with exit 130, matching the recorded earlier environment limitation. The unchanged build succeeded with approved helper-process access. Its pre-existing custom-Babel warning and built-in type-validation skip remain; the independent TypeScript command passes. The generated `next-env.d.ts` dev-path change was normalized by the production build and is not committed.

## Self-review and limits

Reviewed the complete diff for identity separation, default-off behavior, signed-cookie validation, local redirect preservation, credential clearing, stable errors, cancellation forwarding, current identity/selection checks, stale rejection suppression, history/current-round independence, and test fixture lifecycle. The checkout was clean after the implementation commit before this report was added.

No backend, export, restore, deployment script or product documentation changes were made. The existing deployment auth test assertions were updated because the outer route's error envelope changed. Live PostgreSQL, Docker persistence/restore, five-account/five-viewport and public-tunnel acceptance remain unverified by this task. Browser resource coverage directly mounts the questionnaire-list/project-switch paths; questionnaire-detail/user/locale generation behavior is covered by the shared guard/API behavioral tests and code review rather than a full browser scenario for every combination.
