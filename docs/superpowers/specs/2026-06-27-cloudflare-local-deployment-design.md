# Cloudflare Tunnel 本地部署与安全启停设计

## 目标

为 Survey Agent Simulator 建立一套适用于 macOS 的固定域名本地部署方案：

- 公网用户通过固定 HTTPS 域名访问本机运行的 Next.js 服务；
- Cloudflare Access 只允许白名单邮箱通过一次性验证码登录；
- Next.js 不直接暴露给局域网或公网；
- 启动和停止均通过一键脚本完成；
- 启动失败自动回滚；
- 停止脚本验证 Next.js、cloudflared 和监听端口全部关闭；
- 关闭后，固定域名无法通过本方案连接本机任何服务。

本文的“安全关闭”特指关闭本项目的 Next.js 服务、Cloudflare Tunnel 连接和相关监听端口。它不能替代操作系统更新、防火墙、账号安全和其他本机服务的安全管理，也不承诺整台计算机绝对零风险。

## 架构

```text
公网浏览器
   │ HTTPS
   ▼
Cloudflare Access
   │ 邮箱白名单 + OTP
   ▼
Cloudflare Edge / 固定域名
   │ 已认证请求
   ▼
cloudflared 出站 Tunnel
   │ 唯一 ingress
   ▼
127.0.0.1:3000
   │
   ▼
Next.js production server
```

安全边界：

1. Next.js 使用 `-H 127.0.0.1 -p 3000`，不监听 `0.0.0.0`；
2. 不配置路由器端口转发；
3. 不把 cloudflared 安装为 launch agent/daemon，避免退出登录或重启后自动恢复公网入口；
4. Named Tunnel 只包含固定域名到 `http://127.0.0.1:3000` 的规则；
5. ingress 最后一条固定为 `http_status:404`，拒绝其他主机名；
6. Cloudflare Access 使用具体邮箱列表，不允许 `Everyone` 或仅以 `One-time PIN` 作为 Include 条件；
7. Cloudflare API Token、Account ID、Application ID、Policy ID 和 Tunnel 凭据不提交到 Git。

## 目录结构

```text
deploy/
├── README.md
├── ARCHITECTURE.md
├── RUNBOOK.md
├── SECURITY.md
├── TROUBLESHOOTING.md
├── config/
│   ├── deploy.env.example
│   ├── deploy.env
│   ├── allowed-emails.txt.example
│   ├── allowed-emails.txt
│   └── config.yml.example
├── runtime/
│   ├── next.pid
│   ├── cloudflared.pid
│   ├── next.log
│   └── cloudflared.log
└── scripts/
    ├── common.sh
    ├── check-prerequisites.sh
    ├── start.sh
    ├── stop.sh
    ├── status.sh
    ├── sync-access-policy.sh
    └── verify-shutdown.sh
```

`deploy.env`、`allowed-emails.txt`、`runtime/` 和任何 Cloudflare credentials 文件由 `.gitignore` 排除。仓库只提交示例配置；首次使用时按手册复制生成本地实际配置。当前工作区可同时生成空白的本地实际白名单文件，供部署者填写。

## 固定域名与 Tunnel

采用 locally-managed Named Tunnel：

1. 域名已托管到 Cloudflare；
2. 执行 `cloudflared tunnel login`；
3. 创建固定名称的 Tunnel；
4. 用 `cloudflared tunnel route dns` 把固定子域名绑定到 Tunnel；
5. 将实际 `config.yml` 放在 `~/.cloudflared/`，不放入仓库；
6. 启动脚本显式指定该配置并以前台子进程方式运行 cloudflared。

配置模板：

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: <HOME>/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: <PUBLIC_HOSTNAME>
    service: http://127.0.0.1:3000
  - service: http_status:404
```

不会配置 SSH、TCP、RDP、局域网 CIDR 或其他本机端口。

## 邮箱白名单

本地事实源为 `deploy/config/allowed-emails.txt`：

```text
# 每行一个邮箱；空行和 # 注释会被忽略
owner@example.com
collaborator@example.org
```

`sync-access-policy.sh`：

1. 加载被 Git 忽略的 `deploy.env`；
2. 校验 Account/Application/Policy/OTP Identity Provider ID 与 API Token；
3. 读取并规范化邮箱，拒绝空白名单、重复项和非法格式；
4. 使用 `jq` 生成 Access Policy JSON；
5. 通过 Cloudflare API `PUT` 更新该应用的 Allow Policy；
6. Include 仅包含具体邮箱；
7. Require 限定为配置的 OTP Identity Provider；
8. 检查 Cloudflare `success` 字段；失败时保留远端旧策略并返回非零状态；
9. 成功后输出生效邮箱数量，不输出 Token。

调整白名单的固定流程：

```bash
$EDITOR deploy/config/allowed-emails.txt
npm run deploy:sync-access
```

白名单不会在每次启动时自动同步，避免临时文件错误导致意外覆盖远端策略。启动前状态检查会提醒本地文件需要由部署者主动同步。

## 一键启动

入口：

```bash
npm run deploy:start
```

步骤：

1. 获取独占锁，避免重复启动和并发 stop；
2. 检查 macOS、Node.js、npm、cloudflared、curl、jq；
3. 检查 `deploy.env`、白名单、`~/.cloudflared/config.yml` 和 Tunnel credentials；
4. 校验 Tunnel ingress：
   - 目标主机名与 `PUBLIC_HOSTNAME` 一致；
   - 唯一 HTTP origin 为 `127.0.0.1:3000`；
   - 存在最终 `http_status:404`；
5. 检查 3000 端口未被其他进程占用；
6. 检查没有残留 cloudflared 或旧 PID；
7. 执行 `npm run build`；
8. 后台启动 `next start -H 127.0.0.1 -p 3000`；
9. 写入 `next.pid`，轮询本地 HTTP 健康状态；
10. 后台启动指定 Named Tunnel；
11. 写入 `cloudflared.pid`，检查进程仍存活；
12. 输出本地地址、固定公网地址、日志路径和停止命令。

任何一步失败都会调用同一 stop/cleanup 逻辑，终止本轮已启动进程并验证端口关闭。脚本只有在 Next.js 与 Tunnel 都可用时返回成功。

## 一键停止

入口：

```bash
npm stop
```

步骤：

1. 获取独占锁；
2. 读取 `cloudflared.pid` 和 `next.pid`；
3. 校验 PID 对应的命令行确实属于本项目，防止误杀复用 PID 的其他进程；
4. 先向 cloudflared 发送 `TERM`，停止公网入站路径；
5. 等待退出，超时后只对已验证身份的 PID 发送 `KILL`；
6. 再以相同方式停止 Next.js；
7. 删除 PID 文件；
8. 检查项目关联 cloudflared 进程不存在；
9. 检查 `127.0.0.1:3000` 没有监听；
10. 检查本项目 Next.js 进程不存在；
11. 所有检查通过后输出“部署入口已关闭”并返回 0；
12. 任一残留存在时返回非零状态，打印人工处置命令，不输出虚假成功。

停止顺序先 Tunnel、后应用，缩短公网可达窗口。

## 状态与关闭验证

```bash
npm run deploy:status
npm run deploy:verify-stopped
```

状态脚本区分：

- `RUNNING`：两个已验证 PID 都存活，3000 仅监听 loopback；
- `DEGRADED`：只有一个进程存活，或端口/进程不一致；
- `STOPPED`：两个进程均不存在且 3000 未监听；
- `UNSAFE`：3000 监听在 `0.0.0.0`/`::`、发现非预期 cloudflared，或 PID 身份不匹配。

关闭验证必须同时确认：

```bash
pgrep -fl cloudflared
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

本项目相关进程和端口均无输出。固定 DNS 和 Access 应用可以继续存在；它们只会在 Cloudflare 边缘返回登录或错误页面，不构成本机连接。

## package scripts

新增：

```json
{
  "scripts": {
    "deploy:check": "bash deploy/scripts/check-prerequisites.sh",
    "deploy:start": "bash deploy/scripts/start.sh",
    "deploy:status": "bash deploy/scripts/status.sh",
    "deploy:verify-stopped": "bash deploy/scripts/verify-shutdown.sh",
    "deploy:sync-access": "bash deploy/scripts/sync-access-policy.sh",
    "stop": "bash deploy/scripts/stop.sh"
  }
}
```

原有 `start` 保持为 `next start`，供内部或平台部署使用；公网本地部署必须使用 `deploy:start`。

## 验证

静态检查：

- 所有 shell 脚本通过 `bash -n`；
- 示例配置不包含真实 Token、Tunnel UUID、域名或邮箱；
- `.gitignore` 覆盖本地 secrets、白名单、PID 和日志；
- `npm run build` 通过。

行为检查：

1. 缺少依赖、配置或凭据时启动失败且不留下进程；
2. 3000 被占用时启动失败且不误杀占用者；
3. 正常启动后只出现 `127.0.0.1:3000` 监听；
4. Tunnel 配置若包含其他 origin 或缺少 catch-all，启动拒绝；
5. `npm stop` 后两个 PID 消失、端口关闭；
6. 重复执行 stop 幂等；
7. 白名单为空或邮箱非法时拒绝同步；
8. API 错误时不输出 Token，并返回非零状态；
9. 未授权邮箱不能通过 Cloudflare Access；
10. 授权邮箱通过 OTP 后可访问固定域名。

需要真实 Cloudflare 账号、域名和 API Token 的步骤由部署者按 RUNBOOK 执行。仓库验证不会创建 Tunnel、修改 DNS 或调用 Cloudflare API。

## 官方依据

- Cloudflare Tunnel 使用出站连接，不要求公开源站 IP 或开放入站端口；
- Locally-managed Tunnel 的 ingress 必须以 catch-all 规则结束；
- Access Policy 可按具体邮箱允许访问，并默认拒绝未匹配用户；
- OTP 将一次性验证码发送到策略允许的邮箱；
- Access 应用策略可通过 Cloudflare API 更新。
