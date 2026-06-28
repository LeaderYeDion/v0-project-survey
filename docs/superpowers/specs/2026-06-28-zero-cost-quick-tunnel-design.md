# 零费用 Quick Tunnel 部署设计

## 目标

把现有依赖自有域名、Named Tunnel 和 Cloudflare Access 的部署方案，改造成无需域名、无需 Cloudflare 账号、无需 API Token、无需路由器端口转发的零费用方案。

公网访问使用 Cloudflare Quick Tunnel 自动分配的临时 HTTPS 地址。应用使用一个由部署者维护的共享账号和密码保护全部页面、API 与静态资源。停止部署进程后，本机不再保留该公网入口。

## 已选方案与取舍

### 采用：Quick Tunnel + 全局 HTTP Basic Auth

请求路径：

```text
公网浏览器
  → https://<随机名称>.trycloudflare.com
  → Cloudflare Quick Tunnel
  → 本机 cloudflared 出站连接
  → http://127.0.0.1:3000
  → Next.js proxy.ts 全局 Basic Auth
  → 页面、API 与静态资源
```

选择这一方案的原因：

- 不需要购买域名；
- 不需要 Cloudflare 账户、证书、Tunnel credentials、DNS 或 Access Policy；
- 本机不开放入站端口，Next.js 继续只监听 `127.0.0.1`；
- Cloudflare 提供临时 HTTPS 地址，Basic Auth 凭据不会以明文在公网传输；
- `cloudflared` 仍由项目脚本创建和停止，不安装为系统服务；
- 与直接暴露公网 IP 相比，不把 Next.js TCP 端口直接暴露给互联网。

代价和边界：

- 每次启动获得新的随机 `trycloudflare.com` 地址；
- Quick Tunnel 没有 SLA，只适合个人使用、测试和演示；
- 当前官方限制为最多 200 个并发中的请求，且不支持 Server-Sent Events；
- 不再支持 Cloudflare Access 邮箱白名单；
- 未授权请求仍会通过 Tunnel 到达 Next.js 的 Proxy 认证层，但不会获得应用路由、API 响应或静态内容；这不是“攻击请求完全到不了电脑”的保证；
- 浏览器原生 Basic Auth 没有精细用户管理、密码找回、审计或方便的退出按钮。

### 不采用：公网 IP + 端口转发

直接公网 IP 需要服务监听 `0.0.0.0` 或局域网接口，并要求公网 IPv4、无 CGNAT、路由器端口转发和主机防火墙配置。登录认证只能保护应用内容，不能避免端口扫描、暴力尝试和 Web 服务器攻击流量直接到达本机。

该方案与原有“只监听 loopback、不开入站端口、停止后关闭唯一公网路径”的安全目标冲突，因此不实现。

### 暂不采用：Tailscale 私网访问

Tailscale 可以避免公开互联网入口，但每位访问者都需要安装客户端并加入 Tailnet。当前目标是让普通公网浏览器直接访问，因此暂不采用。

## 全局认证设计

在项目根目录增加 Next.js 16 的 `proxy.ts`。Proxy 在路由渲染和静态文件服务之前执行。

部署认证由以下环境变量控制：

```text
DEPLOY_AUTH_ENABLED=true
DEPLOY_USERNAME=survey
DEPLOY_PASSWORD=<至少 20 个字符的随机密码>
```

行为：

1. `DEPLOY_AUTH_ENABLED` 不是 `true` 时放行请求，保持日常 `npm run dev` 不受影响；
2. 部署脚本要求该值必须是 `true`，否则拒绝启动；
3. 缺少账号或密码时返回 `503`，不允许误配置后裸奔；
4. 没有 `Authorization`、格式错误或凭据不匹配时返回 `401`；
5. `401` 响应包含 `WWW-Authenticate: Basic realm="Survey Agent"`，浏览器显示原生登录框；
6. 凭据正确时放行；
7. 比较凭据时使用 Node.js `crypto.timingSafeEqual`，减少简单时序泄漏；
8. Proxy 不配置排除 matcher，因此页面、API、Next.js 静态资源和元数据请求均经过认证。

Basic Auth 只作为单用户、临时部署的轻量门禁，不扩展为多用户权限系统。

## 本地配置

保留一个 Git 忽略的私密文件：

```text
deploy/config/deploy.env
```

内容只包含 loopback、端口和 Basic Auth 凭据：

```bash
LOCAL_HOST=127.0.0.1
LOCAL_PORT=3000
DEPLOY_AUTH_ENABLED=true
DEPLOY_USERNAME=survey
DEPLOY_PASSWORD=<随机密码>
```

新增 `npm run deploy:init`：

- 文件不存在时创建；
- 使用 `openssl rand -hex 24` 生成 48 位十六进制密码；
- 文件权限设置为 `600`；
- 已存在时拒绝覆盖，避免丢失部署者自定义凭据；
- 不在终端打印密码。

账号仅允许字母、数字、点、下划线和连字符，长度 1–64。密码至少 20 个字符，不允许换行。示例文件只含不可用占位值。

删除邮箱白名单、Cloudflare Account/Application/Policy/IdP ID、API Token、Named Tunnel 名称、固定域名和 Tunnel 配置路径。

## 生命周期设计

### 启动

`npm run deploy:start`：

1. 获取生命周期锁；
2. 校验 `cloudflared`、Node.js、npm、curl、lsof、ps、pgrep 和 openssl；
3. 校验 `deploy.env` 权限、loopback、端口和强凭据；
4. 若 `~/.cloudflared/config.yml` 或 `config.yaml` 存在则拒绝启动，并提示暂时重命名，因为 Quick Tunnel 不支持默认配置文件；
5. 拒绝已有本部署 PID、匹配的 Quick Tunnel 进程或 3000 端口监听者；
6. 执行生产构建；
7. 继承部署认证环境变量，启动 `next start -H 127.0.0.1 -p 3000`；
8. 使用不会把密码暴露在进程参数中的临时 curl 配置完成认证健康检查；
9. 验证端口只监听 loopback；
10. 启动：

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

11. 从 cloudflared 日志中提取唯一的 `https://*.trycloudflare.com` 地址，写入 `deploy/runtime/public-url`；
12. 确认进程身份和公网地址格式后报告成功；
13. 任一步失败都先停止本轮 cloudflared，再停止 Next.js，并删除 PID、URL 和临时认证文件。

### 状态

`npm run deploy:status`：

- `RUNNING`：两个 PID 身份正确、端口仅 loopback、public URL 格式正确；
- `STOPPED`：两个 PID、public URL 和端口均不存在；
- `DEGRADED`：只有部分组件存在；
- `UNSAFE`：PID 身份异常、存在非预期匹配进程或端口暴露在非 loopback。

### 停止

`npm stop`：

1. 先停止脚本记录且身份匹配的 Quick Tunnel；
2. 删除 `public-url`；
3. 再停止脚本记录且身份匹配的 Next.js；
4. 检查项目 PID、匹配进程、public URL 和 TCP 3000 均已消失；
5. 任一残留均返回非零，不宽泛执行 `pkill node` 或 `pkill cloudflared`。

如果用户只 kill Next.js，Tunnel 可能暂时仍在线，但 origin 已关闭；应继续执行 `npm stop` 清理 Tunnel。如果只 kill cloudflared，公网入口立即失效，Next.js 仍只在本机 loopback 监听。

## 文件调整

### 新增

- `proxy.ts`：全局 Basic Auth；
- `deploy/scripts/init-config.sh`：生成本地凭据配置；
- `deploy/tests/basic-auth.test.mjs`：认证行为测试；
- `deploy/tests/quick-tunnel-contract.test.mjs`：零费用部署安全契约。

### 重写

- `deploy/scripts/common.sh`
- `deploy/scripts/check-prerequisites.sh`
- `deploy/scripts/start.sh`
- `deploy/scripts/stop.sh`
- `deploy/scripts/status.sh`
- `deploy/scripts/verify-shutdown.sh`
- `deploy/config/deploy.env.example`
- `deploy/README.md`
- `deploy/ARCHITECTURE.md`
- `deploy/RUNBOOK.md`
- `deploy/SECURITY.md`
- `deploy/TROUBLESHOOTING.md`
- `README.md`
- `docs/PROJECT_ITERATION.md`
- `package.json`
- `.gitignore`

### 删除

- `deploy/config/allowed-emails.txt.example`
- `deploy/config/config.yml.example`
- `deploy/scripts/render-access-policy.mjs`
- `deploy/scripts/sync-access-policy.sh`
- `deploy/tests/access-policy.test.mjs`

旧的 Named Tunnel 设计与实施计划留在 `docs/superpowers/` 作为历史决策记录，但实时部署手册只描述 Quick Tunnel。

## 测试与验收

自动化测试覆盖：

- 未启用部署认证时本地开发请求放行；
- 配置缺失时 fail-closed 返回 `503`；
- 缺少、非法或错误 Basic Auth 返回 `401`；
- 正确账号密码放行；
- 未授权响应不包含应用内容；
- 启动命令只使用 `http://127.0.0.1:3000`；
- 不出现 `0.0.0.0`、Named Tunnel、固定 hostname、Access API 或 Token；
- URL 只接受 `https://<随机名称>.trycloudflare.com`；
- 停止顺序是 cloudflared、public URL、Next.js、关闭验证；
- 私密配置和 runtime 被 Git 忽略。

离线验证：

```bash
node --test tests/*.test.mjs deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh
npx tsc --noEmit --incremental false
npm run build
git diff --check
```

联网验收：

1. `npm run deploy:init` 并查看本地账号密码；
2. `npm run deploy:start` 获得临时公网 URL；
3. 无凭据访问返回 `401`；
4. 错误凭据仍返回 `401`；
5. 正确凭据可打开应用；
6. 局域网 IP 的 3000 端口无法连接；
7. `npm stop` 后原临时 URL 无法再到达本机；
8. `npm run deploy:verify-stopped` 成功。

## 官方约束依据

- Cloudflare Quick Tunnel：<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/>
- Cloudflare Tunnel 出站连接：<https://developers.cloudflare.com/tunnel/>
- Next.js 16 Proxy：<https://nextjs.org/docs/app/api-reference/file-conventions/proxy>
