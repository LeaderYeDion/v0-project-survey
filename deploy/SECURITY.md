# Quick Tunnel 安全模型

## 能保证什么

在脚本和配置未被修改的前提下：

- Next.js 只监听 `127.0.0.1:3000`；
- FastAPI 只监听配置的 `127.0.0.1` 后端端口（默认 8000），不直接连接 Tunnel；
- 不开放路由器或主机入站端口；
- cloudflared 只连接该 loopback origin；
- 应用页面和 API 要求有效签名 Cookie，未登录的浏览器导航只进入独立登录页；
- 登录页使用 12 小时 `HttpOnly`、`SameSite=Strict` 会话，部署健康检查兼容 Basic Authorization；
- 缺少认证配置时 fail-closed 返回 503；
- `npm stop` 先关 Tunnel，再关 Next.js 和 FastAPI；
- 停止成功只在进程、临时网址和端口验证全部通过后报告。

## 不能保证什么

- Quick Tunnel 的 SLA、固定网址或生产稳定性；
- 未授权请求完全到不了本机：请求会到达 Next.js Proxy 后才被拒绝；
- 防御 Next.js、依赖或业务代码自身的未知漏洞；
- 保护其他程序开放的端口；
- 防御本地恶意软件或操作系统漏洞；
- 多用户权限、登录审计、速率限制或账号锁定。

## 凭据管理

`deploy/config/deploy.env` 必须保持 `chmod 600`。

建议：

- 使用 `deploy:init` 生成的 48 位随机密码；
- 公网地址与密码通过不同渠道发送；
- 不在终端历史、截图、日志或聊天中粘贴密码；
- 每次人员变化后先停止服务、轮换密码、再重新启动；
- 怀疑泄漏时立即执行 `npm stop`。

登录提交与 Cookie 依赖 Quick Tunnel 提供的 HTTPS。不要把同一账号密码用于其他网站。登录页所需的 Next.js 静态资源可匿名读取，但不包含调研配置或结果数据。

## kill 不同进程的结果

### 只 kill Next.js

- 3000 关闭；
- Tunnel 可能仍在线；
- 公网只能得到 origin unavailable；
- 仍应执行 `npm stop` 清理 Tunnel 和状态文件。

### 只 kill FastAPI

- 配置的后端端口关闭；
- 页面和登录仍可访问，但 `/survey-api/*` 调研功能失败；
- FastAPI 内存中的运行和历史记录丢失；
- 执行 `npm stop` 清理剩余应用与 Tunnel。

### 只 kill cloudflared

- 公网入口立即失效；
- Next.js 仍只在本机 loopback 可访问；
- 执行 `npm stop` 清理应用。

### 执行 `npm stop`

- 校验并停止 cloudflared；
- 删除临时网址；
- 校验并停止 Next.js；
- 校验并停止 FastAPI；
- 检查 PID、匹配进程和配置的前后端端口；
- 有任何残留即返回非零。

## 安全事件处理

1. 执行 `npm stop`；
2. 执行 `npm run deploy:verify-stopped`；
3. 确认配置的前后端 TCP 端口没有 listener；
4. 修改本地密码；
5. 检查 backend、Next.js 和 cloudflared 日志；
6. 确认无异常后重新启动，获得全新的公网地址。

若停止返回 `UNSAFE`，不要使用宽泛的 `pkill node`、`pkill uvicorn` 或 `pkill cloudflared`。先确认具体 PID 和命令。
