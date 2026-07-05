# Quick Tunnel 故障排查

## 缺少 `deploy.env`

```bash
npm run deploy:init
```

如果文件已存在，初始化脚本会拒绝覆盖。

## 私密文件权限错误

```bash
chmod 600 deploy/config/deploy.env
```

## 缺少 cloudflared

```bash
brew install cloudflared
cloudflared version
```

## 缺少或版本错误的后端环境

```bash
bash backend/scripts/bootstrap.sh
npm run deploy:check
```

部署要求项目本地 Python 3.14.6、FastAPI 和 Uvicorn 均可用。

## 默认 config 与 Quick Tunnel 冲突

错误会指出具体 `config.yml` 或 `config.yaml`。如需保留：

```bash
mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.named-tunnel-disabled
```

不要删除不确定用途的配置。

## 3000 或 8000 端口被占用

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

脚本不会自动终止占用者。确认身份后由该服务自己的停止命令处理。

如果 8000 属于其他项目，可在私密 `deploy.env` 中同时修改：

```bash
BACKEND_PORT=8010
SURVEY_BACKEND_URL=http://127.0.0.1:8010
```

## 无法生成 `trycloudflare.com` 地址

```bash
tail -n 100 deploy/runtime/cloudflared.log
```

检查：

- 当前网络能否访问 Cloudflare；
- VPN、代理或防火墙是否阻止 cloudflared 出站；
- 是否存在默认 cloudflared 配置；
- cloudflared 是否为近期版本。

Quick Tunnel 不需要执行 `tunnel login` 或 `tunnel create`。

## 登录页不断报错或登录后又返回登录页

- 确认使用 `deploy.env` 中的账号密码；
- 用户名区分大小写；
- 密码不要带复制出来的空格或换行；
- 确认浏览器允许当前站点写入 Cookie；
- 密码轮换会使旧会话立即失效，重新输入新密码即可；
- 仍无法登录时，关闭该临时站点的全部标签页或使用隐私窗口重试。

## 返回 503

表示部署认证已开启，但 Next.js 运行环境缺少账号或密码。执行：

```bash
npm stop
npm run deploy:check
npm run deploy:start
```

不要通过关闭 `DEPLOY_AUTH_ENABLED` 绕过检查。

## 公网 502 / origin unavailable

Tunnel 在线但 Next.js 不可用：

```bash
npm run deploy:status
tail -n 100 deploy/runtime/next.log
```

先执行停止验证，再重新启动。

## 页面可访问但调研功能失败

依次检查 FastAPI 直连和 Next.js 代理：

```bash
source deploy/config/deploy.env
curl --header "Accept-Language: zh-CN" \
  --fail "http://${BACKEND_HOST}:${BACKEND_PORT}/api/health"
curl --user "$DEPLOY_USERNAME:$DEPLOY_PASSWORD" \
  --header "Accept-Language: zh-CN" \
  --fail "http://${LOCAL_HOST}:${LOCAL_PORT}/survey-api/health"
tail -n 100 deploy/runtime/backend.log
tail -n 100 deploy/runtime/next.log
```

FastAPI 业务接口要求 `Accept-Language` 精确为 `zh-CN` 或 `en-US`；调试 `/survey-api/*` 时也必须携带其中之一。`/api/health` 本身可省略该请求头并默认返回 `Content-Language: zh-CN`，上面的示例显式添加它，以复现部署脚本实际执行的语言契约检查。

如果 FastAPI 已重启，先前保存在内存中的运行和历史记录无法恢复。

## `npm stop` 返回 UNSAFE

```bash
npm run deploy:status
pgrep -fl cloudflared
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

常见原因：

- 非本项目程序占用 3000；
- 非本项目程序占用 8000；
- 手工启动了另一个相同 origin 的 Quick Tunnel；
- PID 被复用或状态文件损坏；
- 服务监听在 `0.0.0.0`。

只处理已确认身份的进程，处理后执行：

```bash
npm run deploy:verify-stopped
```
