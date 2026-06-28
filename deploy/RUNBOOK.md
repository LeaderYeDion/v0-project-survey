# 零费用 Quick Tunnel 操作手册

## 1. 前置条件

- macOS；
- Node.js、npm 和项目依赖已安装；
- 不在路由器上配置任何端口转发；
- 不需要域名或 Cloudflare 账号。

安装 cloudflared：

```bash
brew install cloudflared
cloudflared version
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

## 4. 部署前检查

```bash
npm run deploy:check
```

它会离线检查依赖、私密文件权限、loopback、端口、认证强度和 cloudflared 默认配置冲突，不调用 Cloudflare API，也不启动进程。

如果端口 3000 已被其他服务占用：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
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
4. 启动仅监听 `127.0.0.1:3000` 的 Next.js；
5. 验证本地错误凭据返回 401、正确凭据返回 200；
6. 启动匿名 Quick Tunnel；
7. 提取随机 HTTPS 地址；
8. 验证公网错误凭据返回 401、正确凭据返回 200；
9. 打印公网地址。

任一步失败都会停止本轮已启动的 Tunnel 和 Next.js。

查看状态和地址：

```bash
npm run deploy:status
```

## 6. 使用者访问

将本轮的 `https://*.trycloudflare.com` 地址发送给使用者，并通过安全渠道单独告知账号密码。

使用者：

1. 在浏览器打开临时地址；
2. 在浏览器原生登录框输入账号密码；
3. 凭据正确后进入应用。

错误凭据只能得到 `401 Authentication required`。

## 7. 一键停止

```bash
npm stop
```

脚本先停止 cloudflared，删除临时网址状态，再停止 Next.js，最后检查 PID、匹配进程和 TCP 3000。

再次验证：

```bash
npm run deploy:verify-stopped
```

人工复核：

```bash
pgrep -fl cloudflared
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

与本项目相关的输出应为空。

## 8. 下次启动

账号密码文件会保留，但公网地址会变化：

```bash
npm run deploy:start
```

必须把新地址重新发给使用者。需要更换密码时，先 `npm stop`，编辑 `deploy.env`，再重新启动。
