# Cloudflare Local Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立固定域名、Cloudflare Access OTP 邮箱白名单、Named Tunnel 和一键安全启停组成的本地公网部署工具与手册。

**Architecture:** Next.js 仅监听 `127.0.0.1:3000`，cloudflared 只把一个固定域名转发到该端口，并以 `http_status:404` 拒绝其他入口。启动脚本采用失败回滚，停止脚本先关 Tunnel、再关 Next.js并验证进程与端口；邮箱白名单由独立本地文件生成 Access Policy JSON，并通过 Cloudflare API 显式同步。

**Tech Stack:** Bash 3.2+、Node.js 24、Next.js 16、cloudflared、Cloudflare Tunnel/Access API、curl、jq、macOS launch/process tools

---

### Task 1: 建立部署安全契约测试

**Files:**
- Create: `deploy/tests/deployment-contract.test.mjs`
- Create: `deploy/tests/access-policy.test.mjs`

- [x] **Step 1: 编写缺失实现时失败的部署契约测试**

创建 `deploy/tests/deployment-contract.test.mjs`，读取即将创建的脚本和配置并断言：

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const read = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8")

test("binds Next.js to loopback and rolls back failed starts", async () => {
  const start = await read("deploy/scripts/start.sh")
  assert.match(start, /127\.0\.0\.1/)
  assert.doesNotMatch(start, /-H\s+0\.0\.0\.0/)
  assert.match(start, /trap\s+rollback/)
})

test("stops tunnel before Next.js and verifies shutdown", async () => {
  const stop = await read("deploy/scripts/stop.sh")
  const tunnel = stop.indexOf('stop_role "cloudflared"')
  const next = stop.indexOf('stop_role "next"')
  assert.ok(tunnel >= 0)
  assert.ok(next > tunnel)
  assert.match(stop, /verify-shutdown\.sh/)
})

test("tunnel template exposes one loopback origin and ends in 404", async () => {
  const config = await read("deploy/config/config.yml.example")
  const services = config.match(/service:/g) ?? []
  assert.equal(services.length, 2)
  assert.match(config, /service:\s+http:\/\/127\.0\.0\.1:3000/)
  assert.match(config, /-\s+service:\s+http_status:404\s*$/)
  assert.doesNotMatch(config, /(ssh|rdp|tcp):\/\//)
})

test("package scripts expose one-command lifecycle operations", async () => {
  const pkg = JSON.parse(await read("package.json"))
  assert.equal(pkg.scripts["deploy:start"], "bash deploy/scripts/start.sh")
  assert.equal(pkg.scripts.stop, "bash deploy/scripts/stop.sh")
  assert.equal(pkg.scripts["deploy:verify-stopped"], "bash deploy/scripts/verify-shutdown.sh")
})
```

- [x] **Step 2: 编写白名单策略渲染测试**

创建 `deploy/tests/access-policy.test.mjs`：

```js
import test from "node:test"
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const renderer = new URL("../scripts/render-access-policy.mjs", import.meta.url)

function render(contents, idp = "otp-id") {
  const directory = spawnSync("mktemp", ["-d"], { encoding: "utf8" }).stdout.trim()
  const file = join(directory, "emails.txt")
  return writeFile(file, contents).then(() =>
    spawnSync(process.execPath, [renderer.pathname, file, idp], {
      encoding: "utf8",
    }),
  )
}

test("renders normalized concrete email rules and requires OTP", async () => {
  const result = await render("# team\nOwner@Example.com\nowner@example.com\nuser@zju.edu.cn\n")
  assert.equal(result.status, 0, result.stderr)
  const policy = JSON.parse(result.stdout)
  assert.deepEqual(policy.include, [
    { email: { email: "owner@example.com" } },
    { email: { email: "user@zju.edu.cn" } },
  ])
  assert.deepEqual(policy.require, [{ login_method: { id: "otp-id" } }])
  assert.equal(policy.decision, "allow")
})

test("rejects empty and invalid allowlists", async () => {
  const empty = await render("# no users\n")
  assert.notEqual(empty.status, 0)
  const invalid = await render("not-an-email\n")
  assert.notEqual(invalid.status, 0)
})
```

- [x] **Step 3: 运行测试并确认红灯**

Run:

```bash
node --test deploy/tests/*.test.mjs
```

Expected: FAIL，因为部署脚本、配置和 renderer 尚不存在。

### Task 2: 创建安全配置边界与白名单 renderer

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `deploy/config/deploy.env.example`
- Create: `deploy/config/allowed-emails.txt.example`
- Create: `deploy/config/allowed-emails.txt`（Git 忽略）
- Create: `deploy/config/config.yml.example`
- Create: `deploy/scripts/render-access-policy.mjs`

- [x] **Step 1: 隔离本地 secrets 与运行文件**

在 `.gitignore` 增加：

```gitignore
# Local Cloudflare deployment secrets and runtime state
deploy/config/deploy.env
deploy/config/allowed-emails.txt
deploy/runtime/
deploy/**/*.credentials.json
```

- [x] **Step 2: 添加部署脚本入口**

在 `package.json` 的 `scripts` 中增加：

```json
"deploy:check": "bash deploy/scripts/check-prerequisites.sh",
"deploy:start": "bash deploy/scripts/start.sh",
"deploy:status": "bash deploy/scripts/status.sh",
"deploy:verify-stopped": "bash deploy/scripts/verify-shutdown.sh",
"deploy:sync-access": "bash deploy/scripts/sync-access-policy.sh",
"stop": "bash deploy/scripts/stop.sh"
```

保留原有 `start: "next start"`。

- [x] **Step 3: 写入非敏感配置模板**

`deploy/config/deploy.env.example`：

```bash
PUBLIC_HOSTNAME=survey.example.com
LOCAL_HOST=127.0.0.1
LOCAL_PORT=3000
TUNNEL_NAME=survey-local
TUNNEL_CONFIG_PATH=$HOME/.cloudflared/config.yml
CLOUDFLARE_ACCOUNT_ID=replace-with-account-id
CLOUDFLARE_ACCESS_APP_ID=replace-with-access-app-id
CLOUDFLARE_ACCESS_POLICY_ID=replace-with-policy-id
CLOUDFLARE_OTP_IDP_ID=replace-with-otp-idp-id
CLOUDFLARE_API_TOKEN=replace-with-scoped-api-token
```

`deploy/config/allowed-emails.txt.example` 和本地实际文件：

```text
# 每行一个允许访问的完整邮箱；空行和 # 注释会被忽略
owner@example.com
```

`deploy/config/config.yml.example`：

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: <HOME>/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: survey.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

- [x] **Step 4: 实现策略 renderer**

`render-access-policy.mjs` 接收白名单路径和 OTP IdP ID，忽略注释/空行，转小写、去重、按字典序排序，以基础邮箱正则校验，并输出：

```json
{
  "name": "Local survey email allowlist",
  "decision": "allow",
  "precedence": 1,
  "include": [
    { "email": { "email": "owner@example.com" } }
  ],
  "exclude": [],
  "require": [
    { "login_method": { "id": "otp-id" } }
  ]
}
```

空白名单、非法邮箱或缺失 IdP ID 时输出不含秘密的错误并以非零状态退出。

- [x] **Step 5: 运行 renderer 测试并确认绿灯**

Run:

```bash
node --test deploy/tests/access-policy.test.mjs
```

Expected: 2 tests passed，0 failed。

### Task 3: 实现公共安全函数与前置检查

**Files:**
- Create: `deploy/scripts/common.sh`
- Create: `deploy/scripts/check-prerequisites.sh`

- [x] **Step 1: 实现 `common.sh`**

公共函数必须包含：

```bash
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
CONFIG_DIR="$DEPLOY_DIR/config"
RUNTIME_DIR="$DEPLOY_DIR/runtime"
ENV_FILE="$CONFIG_DIR/deploy.env"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '[deploy] %s\n' "$*"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }
```

并实现：

- `load_deploy_env`：以 `set -a; source "$ENV_FILE"; set +a` 加载，校验固定字段；
- `ensure_runtime_dir`：创建 runtime 并设置 `chmod 700`；
- `pid_file_for_role`：仅接受 `next`/`cloudflared`；
- `pid_matches_role`：用 `ps -p "$pid" -o command=` 验证命令包含项目根路径/`next start` 或 cloudflared + Tunnel 名称；
- `stop_role`：TERM、轮询、经身份复核后 KILL、删除 PID；
- `port_listener`：使用 `lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN`；
- `assert_loopback_listener`：拒绝 `*:`、`0.0.0.0:` 与 `[::]:`；
- `acquire_lock`/`release_lock`：使用原子 `mkdir "$RUNTIME_DIR/lifecycle.lock"`，不依赖新版 flock。

- [x] **Step 2: 实现前置检查**

`check-prerequisites.sh`：

1. 加载 common；
2. 检查 `node npm cloudflared curl jq lsof ps`;
3. 校验 `deploy.env` 和白名单存在且权限不是 group/world writable；
4. 校验 `LOCAL_HOST=127.0.0.1`、`LOCAL_PORT=3000`；
5. 校验 Tunnel config 和 credentials 存在；
6. 执行 `cloudflared tunnel ingress validate --config "$TUNNEL_CONFIG_PATH"`；
7. 检查文本配置只含 `http://127.0.0.1:3000` 这一条 HTTP origin，并以 `http_status:404` 结尾；
8. 调用 renderer 验证白名单；
9. 不调用 Cloudflare API、不修改系统状态。

- [x] **Step 3: 检查 shell 语法**

Run:

```bash
bash -n deploy/scripts/common.sh deploy/scripts/check-prerequisites.sh
```

Expected: exit 0。

### Task 4: 实现 fail-closed 生命周期脚本

**Files:**
- Create: `deploy/scripts/start.sh`
- Create: `deploy/scripts/stop.sh`
- Create: `deploy/scripts/status.sh`
- Create: `deploy/scripts/verify-shutdown.sh`

- [x] **Step 1: 实现 `start.sh`**

关键结构：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

STARTED_NEXT=0
STARTED_TUNNEL=0
rollback() {
  trap - ERR INT TERM
  [ "$STARTED_TUNNEL" -eq 1 ] && stop_role "cloudflared" || true
  [ "$STARTED_NEXT" -eq 1 ] && stop_role "next" || true
  release_lock
}
trap rollback ERR INT TERM
```

随后：

1. acquire lock；
2. 调用 `check-prerequisites.sh`；
3. 拒绝已有 PID、cloudflared 或 3000 listener；
4. `npm run build`；
5. 后台执行 `npm run start -- -H 127.0.0.1 -p 3000`，日志写 runtime；
6. 写 PID 并以 curl 轮询 `http://127.0.0.1:3000`；
7. 确认 listener 只绑定 loopback；
8. 后台执行 `cloudflared tunnel --config "$TUNNEL_CONFIG_PATH" run "$TUNNEL_NAME"`；
9. 写 PID、等待两秒并确认 PID 存活且身份匹配；
10. 清除 trap、释放锁、打印固定域名和 `npm stop`。

- [x] **Step 2: 实现 `stop.sh`**

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_deploy_env
ensure_runtime_dir
acquire_lock
trap release_lock EXIT

stop_role "cloudflared"
stop_role "next"
"$DEPLOY_DIR/scripts/verify-shutdown.sh" --lock-held
```

`stop_role` 必须幂等；PID 身份不匹配时拒绝 kill 并返回非零。

- [x] **Step 3: 实现状态和关闭验证**

`status.sh` 输出并返回：

- 0 `RUNNING`：两个 PID 身份正确，端口仅 loopback；
- 3 `STOPPED`：两个 PID 不存在，端口关闭；
- 4 `DEGRADED`：只有部分组件存在；
- 5 `UNSAFE`：非预期 cloudflared、端口暴露到非 loopback 或 PID 身份不匹配。

`verify-shutdown.sh` 只在以下条件全部满足时返回 0：

- PID 文件不存在或 PID 已退出；
- `pgrep -fl cloudflared` 中没有与 `TUNNEL_NAME` 匹配的进程；
- 3000 没有 listener；
- 没有包含项目根路径和 `next start` 的进程。

- [x] **Step 4: 运行安全契约测试**

Run:

```bash
bash -n deploy/scripts/*.sh
node --test deploy/tests/deployment-contract.test.mjs
```

Expected: 4 tests passed，0 failed；所有 shell 语法通过。

### Task 5: 实现 Access 同步

**Files:**
- Create: `deploy/scripts/sync-access-policy.sh`

- [x] **Step 1: 实现同步脚本**

脚本：

1. `set -Eeuo pipefail`；
2. 加载 common/env；
3. 检查 `curl jq node`；
4. 调用 renderer 写入 `mktemp`，并用 trap 删除；
5. PUT：

```text
https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$CLOUDFLARE_ACCESS_APP_ID/policies/$CLOUDFLARE_ACCESS_POLICY_ID
```

Headers:

```text
Authorization: Bearer $CLOUDFLARE_API_TOKEN
Content-Type: application/json
```

6. 响应写临时文件；
7. `jq -e '.success == true'` 验证；
8. 失败只输出 Cloudflare error code/message，不输出请求 Header、env 或 Token；
9. 成功输出策略 ID 与邮箱数量。

- [x] **Step 2: 校验语法与失败路径**

Run:

```bash
bash -n deploy/scripts/sync-access-policy.sh
env -i PATH="$PATH" bash deploy/scripts/sync-access-policy.sh
```

Expected: 语法通过；缺少配置时非零退出且不显示敏感值。

### Task 6: 编写部署、操作与安全手册

**Files:**
- Create: `deploy/README.md`
- Create: `deploy/ARCHITECTURE.md`
- Create: `deploy/RUNBOOK.md`
- Create: `deploy/SECURITY.md`
- Create: `deploy/TROUBLESHOOTING.md`
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: 编写入口文档**

`deploy/README.md` 包含：

- 适用范围和安全保证边界；
- 目录导航；
- 首次部署最短路径；
- 日常四个命令；
- 固定域名、OTP 和进程停止后的预期表现；
- 官方 Cloudflare 文档链接。

- [x] **Step 2: 编写架构与安全文档**

`ARCHITECTURE.md` 记录数据流、信任边界、127.0.0.1 绑定、出站 Tunnel、404 catch-all 和无端口转发。

`SECURITY.md` 记录：

- Access 邮箱白名单与 OTP；
- secrets 权限和轮换；
- 为什么不安装 cloudflared 系统服务；
- kill Next、kill Tunnel、`npm stop` 三种状态的差异；
- 关闭验证清单；
- 剩余风险和事件响应。

- [x] **Step 3: 编写完整 RUNBOOK**

必须覆盖：

1. 域名接入 Cloudflare；
2. `brew install cloudflared jq`；
3. `cloudflared tunnel login/create/route dns`；
4. 创建 `~/.cloudflared/config.yml`；
5. Zero Trust 启用 OTP；
6. 创建 Self-hosted Application 与具体邮箱 Allow Policy；
7. 创建最小权限 API Token；
8. 填写 `deploy.env` 和白名单；
9. 同步白名单；
10. `npm run deploy:check`；
11. `npm run deploy:start`；
12. 公网 OTP 验收；
13. `npm stop`；
14. `npm run deploy:verify-stopped`。

- [x] **Step 4: 编写故障处理**

`TROUBLESHOOTING.md` 覆盖：

- 1033/Tunnel disconnected；
- 502/origin down；
- OTP 收不到或已使用；
- DNS 未生效；
- PID stale/mismatch；
- 3000 被占用；
- stop 返回 UNSAFE；
- API 401/403；
- 恢复前必须先运行关闭验证。

- [x] **Step 5: 同步项目文档**

README 增加“安全本地公网部署”入口；迭代台账新增本次文档/工具迭代记录，不把真实 Tunnel 或域名写成已部署。

### Task 7: 最终验证与提交

**Files:**
- Verify: `deploy/**`
- Verify: `.gitignore`
- Verify: `package.json`
- Verify: `README.md`
- Verify: `docs/PROJECT_ITERATION.md`

- [ ] **Step 1: 运行离线验证**

状态：除生产构建外已通过；本轮生产构建因执行环境拒绝提权而未能重新运行，需在部署机补验。

```bash
node --test deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh
npm run build
git diff --check
```

Expected: Node tests 全部通过；shell 语法通过；构建成功；diff check 无输出。

- [x] **Step 2: 验证 secrets 不会提交**

状态：已完成。

```bash
git check-ignore deploy/config/deploy.env
git check-ignore deploy/config/allowed-emails.txt
git check-ignore deploy/runtime/next.pid
rg -n 'api[_-]?token|Bearer [A-Za-z0-9_-]{20,}' deploy --glob '!*.md' --glob '!*.example'
```

Expected: 三个路径均被 ignore；敏感值扫描无真实 Token。

- [ ] **Step 3: 验证停止脚本的安全失败**

状态：已验证 3000 被非本部署进程占用时返回非零且不终止该进程；由于当前端口已被占用，空闲端口下的幂等成功路径需在部署机补验。

在没有运行部署进程时：

```bash
npm stop
npm run deploy:verify-stopped
```

Expected: 两者幂等成功；3000 若被非本项目进程占用则明确返回非零，不会杀死该进程。

- [ ] **Step 4: 提交**

```bash
git add .gitignore package.json README.md docs/PROJECT_ITERATION.md deploy \
  docs/superpowers/plans/2026-06-27-cloudflare-local-deployment.md
git commit -m "feat: add secure Cloudflare local deployment toolkit"
```

本地 `deploy.env`、`allowed-emails.txt`、runtime 和 Cloudflare credentials 不得进入提交。
