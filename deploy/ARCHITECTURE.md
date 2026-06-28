# 零费用部署架构与信任边界

## 请求路径

```text
公网浏览器
   │ HTTPS + Basic Auth
   ▼
随机 *.trycloudflare.com 地址
   │
   ▼
Cloudflare Edge
   │ Quick Tunnel
   ▼
本机 cloudflared（仅出站连接）
   │ 唯一 origin
   ▼
http://127.0.0.1:3000
   │
   ▼
Next.js proxy.ts（全局认证）
   │
   ▼
页面、API、静态资源
```

Quick Tunnel 不要求公开本机 IP、配置 DNS 或开放路由器端口。Next.js 明确通过以下命令启动：

```bash
next start -H 127.0.0.1 -p 3000
```

因此局域网设备也不能直接访问 3000。公网只能通过本轮 cloudflared 进程获得的临时地址进入。

## 认证边界

部署脚本强制：

```text
DEPLOY_AUTH_ENABLED=true
```

Next.js 16 `proxy.ts` 在路由和静态文件之前执行：

- 缺少部署凭据配置：`503`；
- 缺少、非法或错误账号密码：`401`；
- 正确账号密码：继续处理请求；
- 响应禁用认证错误缓存。

未授权请求仍会到达本机 Next.js 的 Proxy 层，因此认证不能消除应用运行期间的全部攻击面。它的作用是阻止未授权用户读取或调用应用内容。

## 运行状态

| 状态 | Next.js | cloudflared | 临时网址 | 结果 |
| --- | --- | --- | --- | --- |
| RUNNING | 运行 | 运行 | 有效 | 正确凭据可访问 |
| Origin down | 停止 | 运行 | 存在 | Cloudflare 显示 origin 错误 |
| Tunnel down | 运行 | 停止 | 已失效 | 仅本机 loopback 可访问 |
| STOPPED | 停止 | 停止 | 已删除 | 无本项目入口 |
| UNSAFE | 未知 | 未知 | 未知 | 需人工检查 |

## 进程所有权

脚本只会终止 PID 文件中记录且命令身份匹配的进程：

- Next.js 命令包含项目绝对路径、`next` 和 `start`；
- cloudflared 命令包含 `cloudflared tunnel --url` 和 `http://127.0.0.1:3000`。

PID 被复用或身份不匹配时，脚本拒绝 kill，避免伤及其他进程。

## 不安装系统服务

本方案不会执行 `cloudflared service install`。Quick Tunnel 只作为 `deploy:start` 创建的普通进程存在，避免登录、开机或异常退出后自动恢复公网入口。

## 明确不在范围内

- 正式生产可用性或固定网址；
- 多用户、角色、审计和密码找回；
- 操作系统、浏览器或其他本机服务漏洞；
- 应用运行期间自身存在的 Web 漏洞；
- 本地恶意软件或已取得系统权限的攻击者。
