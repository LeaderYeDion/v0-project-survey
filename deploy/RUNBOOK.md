# 零费用 Quick Tunnel 操作手册

## 1. 前置条件

- macOS；
- Node.js、npm 和项目依赖已安装；
- 后端 Python 3.14.6 虚拟环境已初始化；
- 不在路由器上配置任何端口转发；
- 不需要域名或 Cloudflare 账号。

安装 cloudflared：

```bash
brew install cloudflared
cloudflared version
bash backend/scripts/bootstrap.sh
```

不要执行：

```bash
cloudflared tunnel login
cloudflared tunnel create
cloudflared service install
sudo cloudflared service install
```

## 2. 清理默认 cloudflared 配置冲突

Quick Tunnel 不能与默认 `config.yml` 或 `config.yaml` 一起使用。检查：

```bash
find ~/.cloudflared /etc/cloudflared /usr/local/etc/cloudflared \
  -maxdepth 1 \( -name config.yml -o -name config.yaml \) 2>/dev/null
```

如果存在且仍需保留，临时重命名，例如：

```bash
mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.named-tunnel-disabled
```

不要删除不确定用途的配置。

## 3. 生成本地账号密码

```bash
npm run deploy:init
```

脚本会创建：

```text
deploy/config/deploy.env
```

文件权限为 `600`，内容类似：

```bash
LOCAL_HOST=127.0.0.1
LOCAL_PORT=3000
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8000
SURVEY_BACKEND_URL=http://127.0.0.1:8000
DEPLOY_AUTH_ENABLED=true
DEPLOY_USERNAME=survey
DEPLOY_PASSWORD=<48位随机十六进制密码>
```

查看或修改：

```bash
$EDITOR deploy/config/deploy.env
chmod 600 deploy/config/deploy.env
```

用户名只能包含字母、数字、点、下划线和连字符；密码至少 20 个字符。不要把该文件发到聊天、Issue 或 Git。

8000 被占用时，可以把 `BACKEND_PORT` 和 `SURVEY_BACKEND_URL` 改为同一个空闲端口，例如 8010；`BACKEND_HOST` 必须保持 `127.0.0.1`。

## 4. 部署前检查

```bash
npm run deploy:check
```

它会离线检查依赖、Python 3.14.6 后端环境、私密文件权限、loopback、端口、认证强度和 cloudflared 默认配置冲突，不调用 Cloudflare API，也不启动进程。

如果端口 3000 或 8000 已被其他服务占用：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

请先确认进程身份并由其所有者停止。部署脚本不会擅自 kill。

## 5. 一键启动

```bash
npm run deploy:start
```

脚本依次：

1. 获取生命周期锁；
2. 检查配置；
3. 构建生产版本；
4. 启动仅监听 `BACKEND_HOST:BACKEND_PORT`（默认 `127.0.0.1:8000`）的 FastAPI，并检查 `/api/health`；
5. 启动仅监听 `127.0.0.1:3000` 的 Next.js；
6. 使用 Basic Authorization 验证本地页面和 `/survey-api/health`，并确认未认证请求返回 401；
7. 启动匿名 Quick Tunnel；
8. 提取随机 HTTPS 地址；
9. 使用相同健康检查验证公网页面和代理后的 FastAPI；
10. 打印公网地址。

任一步失败都会停止本轮已启动的 Tunnel、Next.js 和 FastAPI。

运行日志位于 `deploy/runtime/backend.log`、`next.log` 和 `cloudflared.log`。

查看状态和地址：

```bash
npm run deploy:status
```

## 6. 使用者访问

将本轮的 `https://*.trycloudflare.com` 地址发送给使用者，并通过安全渠道单独告知账号密码。

使用者：

1. 在浏览器打开临时地址；
2. 在项目登录页输入账号密码；
3. 凭据正确后进入应用并获得 12 小时浏览器会话。

错误凭据会留在登录页并显示“用户名或密码不正确”。部署脚本和其他非 HTML 请求的错误凭据仍得到 `401 Authentication required`。

## 7. 一键停止

```bash
npm stop
```

脚本先停止 cloudflared，删除临时网址状态，再停止 Next.js 和 FastAPI，最后检查 PID、匹配进程以及配置的前后端端口。

再次验证：

```bash
npm run deploy:verify-stopped
```

人工复核：

```bash
pgrep -fl cloudflared
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

与本项目相关的输出应为空。

## 8. 下次启动

账号密码文件会保留，但公网地址会变化：

```bash
npm run deploy:start
```

必须把新地址重新发给使用者。需要更换密码时，先 `npm stop`，编辑 `deploy.env`，再重新启动。

FastAPI 使用内存仓储；停止或重启后端会清空当前运行和历史记录。
