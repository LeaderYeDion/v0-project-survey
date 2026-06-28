# Zero-Cost Quick Tunnel Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the domain-dependent Named Tunnel deployment with a zero-cost Quick Tunnel protected by global Basic Auth and fail-closed one-command lifecycle scripts.

**Architecture:** Next.js listens only on `127.0.0.1:3000`; a Next.js 16 `proxy.ts` rejects every unauthenticated request before route rendering; an anonymous `cloudflared tunnel --url` process supplies a temporary HTTPS URL. Local scripts create private credentials, start and verify both processes, extract the random URL, and stop the Tunnel before the application.

**Tech Stack:** Bash 3.2+, Node.js 24, Next.js 16 Proxy, TypeScript, Cloudflare Quick Tunnel, Node test runner

---

### Task 1: Define Basic Auth and Quick Tunnel contracts

**Files:**
- Create: `deploy/tests/basic-auth.test.mjs`
- Replace: `deploy/tests/deployment-contract.test.mjs`
- Delete: `deploy/tests/access-policy.test.mjs`

- [x] **Step 1: Write failing Basic Auth tests**

Create tests that import `proxy.ts`, set deployment environment variables, construct `NextRequest` objects, and assert:

```js
test("allows requests when deployment auth is disabled")
test("fails closed when enabled credentials are missing")
test("challenges missing, malformed, and incorrect credentials")
test("allows the configured Basic Auth credentials")
```

The tests must verify `503` for missing configuration, `401` plus `WWW-Authenticate` for rejected credentials, and `NextResponse.next()` for accepted credentials.

- [x] **Step 2: Write failing Quick Tunnel contract tests**

Replace the existing Named Tunnel assertions with checks that:

```js
assert.match(start, /cloudflared tunnel/)
assert.match(start, /--url/)
assert.match(start, /127\.0\.0\.1/)
assert.match(start, /trycloudflare\\\.com/)
assert.doesNotMatch(start, /TUNNEL_NAME|PUBLIC_HOSTNAME|ACCESS_POLICY/)
assert.ok(stop.indexOf('stop_role "cloudflared"') < stop.indexOf('stop_role "next"'))
```

Also assert that package scripts expose `deploy:init`, `deploy:start`, `deploy:status`, `deploy:verify-stopped`, and `stop`, but no `deploy:sync-access`.

- [x] **Step 3: Run tests and confirm RED**

Run:

```bash
node --test deploy/tests/basic-auth.test.mjs deploy/tests/deployment-contract.test.mjs
```

Expected: FAIL because `proxy.ts`, `deploy:init`, and Quick Tunnel lifecycle behavior do not exist.

### Task 2: Implement global Basic Auth and private config initialization

**Files:**
- Create: `proxy.ts`
- Create: `deploy/scripts/init-config.sh`
- Replace: `deploy/config/deploy.env.example`
- Modify: `package.json`
- Modify: `.gitignore`

- [x] **Step 1: Implement `proxy.ts`**

Implement a named `proxy(request)` export:

```ts
if (process.env.DEPLOY_AUTH_ENABLED !== "true") {
  return NextResponse.next()
}
```

When enabled, require `DEPLOY_USERNAME` and `DEPLOY_PASSWORD`; return `503` if either is absent. Decode a `Basic` Authorization header, split on the first colon, compare both values with `timingSafeEqual`, and return:

```ts
new NextResponse("Authentication required", {
  status: 401,
  headers: {
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Survey Agent", charset="UTF-8"',
  },
})
```

Do not export a matcher so Proxy runs before all project routes.

- [x] **Step 2: Implement private config initialization**

`deploy/scripts/init-config.sh` must require `openssl`, refuse to overwrite an existing `deploy.env`, generate `openssl rand -hex 24`, write:

```bash
LOCAL_HOST=127.0.0.1
LOCAL_PORT=3000
DEPLOY_AUTH_ENABLED=true
DEPLOY_USERNAME=survey
DEPLOY_PASSWORD=<generated hex>
```

Set the file mode to `600` and print only its path.

- [x] **Step 3: Replace configuration and package entries**

`deploy.env.example` contains the same fields with an unusable password marker. Add:

```json
"deploy:init": "bash deploy/scripts/init-config.sh"
```

Remove `deploy:sync-access`. Remove allowlist-specific ignores while retaining:

```gitignore
deploy/config/deploy.env
deploy/runtime/
deploy/**/*.credentials.json
```

- [x] **Step 4: Run tests and confirm GREEN**

Run:

```bash
node --test deploy/tests/basic-auth.test.mjs
npx tsc --noEmit --incremental false
```

Expected: Basic Auth tests pass and TypeScript exits 0.

### Task 3: Replace shared lifecycle helpers and prerequisite checks

**Files:**
- Replace: `deploy/scripts/common.sh`
- Replace: `deploy/scripts/check-prerequisites.sh`

- [x] **Step 1: Rewrite deployment environment validation**

`load_deploy_env` must require only:

```text
LOCAL_HOST LOCAL_PORT DEPLOY_AUTH_ENABLED DEPLOY_USERNAME DEPLOY_PASSWORD
```

Require loopback, port 3000, auth enabled, username matching `^[A-Za-z0-9._-]{1,64}$`, and password length at least 20.

- [x] **Step 2: Rewrite Quick Tunnel ownership checks**

Cloudflared PID identity must require `cloudflared`, `tunnel`, `--url`, and `http://127.0.0.1:3000`. Matching process discovery uses the same origin signature. Add helpers:

```bash
public_url_file
read_public_url
is_valid_quick_tunnel_url
remove_public_url
```

Only accept `https://[a-z0-9-]+.trycloudflare.com`.

- [x] **Step 3: Rewrite prerequisite checks**

Require `node npm cloudflared curl lsof ps pgrep openssl`. Verify private config mode and reject these default files when present:

```text
~/.cloudflared/config.yml
~/.cloudflared/config.yaml
/etc/cloudflared/config.yml
/etc/cloudflared/config.yaml
/usr/local/etc/cloudflared/config.yml
/usr/local/etc/cloudflared/config.yaml
```

The check performs no network calls and changes no process state.

- [x] **Step 4: Verify shell syntax**

Run:

```bash
bash -n deploy/scripts/common.sh deploy/scripts/check-prerequisites.sh
```

Expected: exit 0.

### Task 4: Implement fail-closed Quick Tunnel lifecycle

**Files:**
- Replace: `deploy/scripts/start.sh`
- Replace: `deploy/scripts/stop.sh`
- Replace: `deploy/scripts/status.sh`
- Replace: `deploy/scripts/verify-shutdown.sh`

- [x] **Step 1: Rewrite start**

Preserve the `ERR`, `INT`, `TERM`, and `EXIT` rollback behavior. After build:

1. Start Next on loopback.
2. Create a mode-600 temporary curl config containing the Basic header.
3. Verify local `/` returns 200 with credentials and 401 without credentials.
4. Confirm the listener is loopback-only.
5. Start `cloudflared tunnel --url http://127.0.0.1:3000`.
6. Poll the log for one `https://*.trycloudflare.com` URL.
7. Write it to `deploy/runtime/public-url`.
8. Verify the public URL rejects an unauthenticated request with 401 and succeeds with credentials.
9. Remove the temporary curl config before reporting success.

Any failure removes the temporary file and public URL, then stops cloudflared before Next.js.

- [x] **Step 2: Rewrite stop and shutdown verification**

Stop order:

```bash
stop_role "cloudflared"
remove_public_url
stop_role "next"
"$SCRIPT_DIR/verify-shutdown.sh" --lock-held
```

Shutdown verification requires no PID file, matching process, public URL file, or port 3000 listener.

- [x] **Step 3: Rewrite status**

`RUNNING` requires both valid PIDs, loopback listener, and valid public URL. `STOPPED` requires none. Partial state returns `DEGRADED`; identity, unexpected process, invalid URL, or non-loopback listener returns `UNSAFE`.

- [x] **Step 4: Run lifecycle contracts**

Run:

```bash
bash -n deploy/scripts/*.sh
node --test deploy/tests/deployment-contract.test.mjs
```

Expected: all deployment contract tests pass.

### Task 5: Remove Named Tunnel artifacts and rewrite documentation

**Files:**
- Delete: `deploy/config/allowed-emails.txt.example`
- Delete: `deploy/config/config.yml.example`
- Delete: `deploy/scripts/render-access-policy.mjs`
- Delete: `deploy/scripts/sync-access-policy.sh`
- Replace: `deploy/README.md`
- Replace: `deploy/ARCHITECTURE.md`
- Replace: `deploy/RUNBOOK.md`
- Replace: `deploy/SECURITY.md`
- Replace: `deploy/TROUBLESHOOTING.md`
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: Remove obsolete artifacts**

Delete Named Tunnel config, email allowlist renderer/synchronizer, and their tests. Do not delete historical specs under `docs/superpowers/`.

- [x] **Step 2: Rewrite deploy documentation**

All live deployment documents must state:

- total Cloudflare cost is zero;
- no domain, account, API token, DNS, cert, or port forwarding;
- each URL is temporary and random;
- browser-native Basic Auth protects every app request;
- Quick Tunnel is for testing/personal demos, has no SLA, allows 200 in-flight requests, and does not support SSE;
- direct public IP exposure is intentionally rejected;
- exact `deploy:init`, start, status, stop, and verification commands;
- remaining risks and incident response.

- [x] **Step 3: Update project documentation**

README and iteration records must replace fixed-domain/email-whitelist claims with the implemented Quick Tunnel and Basic Auth behavior. Record the prior Named Tunnel design as superseded, not deployed.

- [x] **Step 4: Scan for stale live guidance**

Run:

```bash
rg -n 'Named Tunnel|固定域名|邮箱白名单|CLOUDFLARE_API_TOKEN|ACCESS_POLICY|tunnel create|route dns' deploy README.md docs/PROJECT_ITERATION.md
```

Expected: no live instructions remain; historical wording in the iteration log is explicitly marked superseded.

### Task 6: Verify offline and perform a real zero-cost lifecycle test

**Files:**
- Verify: `proxy.ts`
- Verify: `deploy/**`
- Verify: `README.md`
- Verify: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: Run full offline checks**

```bash
node --test tests/*.test.mjs deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh
npx tsc --noEmit --incremental false
npm run build
git diff --check
```

Expected: all tests, syntax, type checking, build, and diff checks pass.

- [x] **Step 2: Verify secret isolation**

```bash
git check-ignore deploy/config/deploy.env deploy/runtime/public-url
rg -n 'DEPLOY_PASSWORD=[A-Fa-f0-9]{20,}' . \
  --glob '!deploy/config/deploy.env' \
  --glob '!node_modules/**' \
  --glob '!.next/**'
```

Expected: local credentials and runtime are ignored; no generated password appears in tracked files.

- [ ] **Step 3: Run the real lifecycle**

Status: Quick Tunnel started successfully and its built-in checks observed local/public `401` without credentials and `200` with credentials. The Codex process sandbox reaped background children after the start command returned, so a separate live `deploy:status` command could not observe the still-running state.

Ensure port 3000 is free, then:

```bash
npm run deploy:init
npm run deploy:start
npm run deploy:status
```

Verify local and public requests return 401 without credentials and 200 with credentials. Never print the generated password.

- [x] **Step 4: Stop and prove closure**

```bash
npm stop
npm run deploy:verify-stopped
```

Expected: cloudflared is stopped first; no matching process, runtime URL, or port 3000 listener remains.

- [ ] **Step 5: Commit implementation**

Stage only project deployment/auth/documentation files, excluding `.idea/` and ignored secrets, then commit:

```bash
git commit -m "feat: add zero-cost authenticated quick tunnel deployment"
```
