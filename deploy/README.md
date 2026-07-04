# 零费用临时公网部署

本目录提供面向 macOS 的 Cloudflare Quick Tunnel 部署工具。它不需要购买域名、Cloudflare 账号、API Token、DNS 配置或路由器端口转发。

默认安全模型：

- Next.js 只监听 `127.0.0.1:3000`；
- FastAPI 默认只监听 `127.0.0.1:8000`，端口冲突时可在 `deploy.env` 中调整，并由 Next.js Rewrite 代理；
- cloudflared 仅建立出站连接；
- Cloudflare 每次启动分配一个随机 HTTPS `trycloudflare.com` 地址；
- Next.js 全局 Proxy 对应用页面和 API 执行认证，浏览器使用独立登录页与 12 小时签名 Cookie 会话；
- 部署脚本的本地与公网健康检查继续使用 Basic Authorization，不改变一键启停契约；
- 本地账号密码保存在 Git 忽略且权限为 `600` 的配置文件；
- cloudflared 不安装为系统服务；
- `npm stop` 依次关闭 Tunnel、Next.js、FastAPI，并验证进程、临时网址和两个端口全部消失。

停止成功后，刚才的 Quick Tunnel 不再连接本机。它不等于整台计算机绝对零风险；操作系统、其他服务和应用自身漏洞仍需独立保护。

## 五分钟开始

```bash
brew install cloudflared
bash backend/scripts/bootstrap.sh
npm run deploy:init
```

查看或修改生成的账号密码：

```bash
$EDITOR deploy/config/deploy.env
```

检查并启动：

```bash
npm run deploy:check
npm run deploy:start
```

启动完成后，终端会打印类似：

```text
https://random-words.trycloudflare.com
```

把该地址发给使用者。浏览器会进入项目自己的登录页；使用 `deploy.env` 中的 `DEPLOY_USERNAME` 和 `DEPLOY_PASSWORD` 登录。普通页面访问不会再显示浏览器原生账号密码对话框。

## 日常命令

```bash
npm run deploy:init            # 首次生成私密账号密码，不覆盖已有文件
npm run deploy:check           # 离线检查配置与安全前提
npm run deploy:start           # 构建、启动应用和 Quick Tunnel
npm run deploy:status          # 查看临时网址和运行状态
npm stop                       # 先关 Tunnel，再关应用并验证
npm run deploy:verify-stopped  # 独立复核入口已关闭
```

## 必须了解的限制

Quick Tunnel 是 Cloudflare 提供的免费开发/演示工具：

- 地址每次启动都会变化；
- 没有 SLA 或可用性保证；
- 最多 200 个并发中的请求；
- 不支持 Server-Sent Events；
- 不提供 Cloudflare Access 邮箱白名单；
- 只有单个共享账号密码，不提供多用户审计或权限管理。

本项目当前前端流程不依赖 SSE。不要把这一方案当作正式生产部署。

FastAPI 当前使用内存仓储；执行 `npm stop`、后端崩溃或重启都会清空运行和历史记录。

## 为什么不直接暴露公网 IP

公网 IP 方案要求 Next.js 监听外网接口并配置路由器端口转发。即使有登录页，端口扫描和攻击请求仍会直接到达本机 Web 服务器，也可能受 CGNAT、动态 IP 和 TLS 证书问题影响。

本方案保持 loopback-only，不开放任何入站端口。

## 文档导航

- [架构与信任边界](./ARCHITECTURE.md)
- [首次部署与日常操作](./RUNBOOK.md)
- [安全模型与停止验证](./SECURITY.md)
- [故障排查](./TROUBLESHOOTING.md)

## 官方资料

- [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
