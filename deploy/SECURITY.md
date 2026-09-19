# Docker 部署安全模型

## 业务身份与数据隔离

五个应用用户是业务身份的唯一来源。API 从 HttpOnly `survey_session` 解析当前用户，浏览器不能传入任意 owner ID。项目是所有权根；问卷、版本、轮次、结果、分析、异常与导出都通过 owner-scoped 仓储查询访问。

不存在和跨用户资源统一返回 `404 RESOURCE_NOT_FOUND`，避免确认他人资源是否存在。产品内没有跨用户管理员读取、项目共享、角色或注册功能。

## 密码、会话和 CSRF

- 初始明文密码由 mode-600 的宿主文件 `deploy/config/seed-users.json` 保存；容器启动时它还会通过只读 Compose secret 挂载，并复制为容器内私密副本；
- PostgreSQL 只保存 Argon2id 密码 hash；
- 原始会话 token 仅进入 HttpOnly、SameSite=Strict、Path=/ Cookie，数据库只保存 token hash；
- HTTPS 请求的会话 Cookie 带 Secure；
- 状态变更同时校验可读 `survey_csrf` Cookie、`X-CSRF-Token`、数据库中的 CSRF hash 以及 Origin/转发 Host；
- 登出撤销数据库会话并清除 Cookie；过期/撤销/停用用户统一得到 `401 AUTH_SESSION_EXPIRED`。

不要把会话 token 或密码放进 `localStorage`、`sessionStorage`、URL、日志、Issue 或聊天。

## 可选外围门禁

`DEPLOY_AUTH_ENABLED=false` 是默认值。启用时，Next.js proxy 对入口增加一层共同外围凭据；健康脚本把这些凭据写入临时 mode-600 curl config，而不是命令行参数。

外围门禁不是应用身份：通过它之后仍要使用 `researcher0N` 登录。外围 Cookie 或 Basic Authorization 不会创建 `CurrentUser`，也不能绕过 FastAPI 所有权。共享凭据没有个人审计能力，只应作为临时公网演示的附加限制。

启用时 `/login` 先验证外围账号，成功后重置表单，再请求独立的应用登录。服务端只接受经过签名校验的外围 Cookie。过期外围会话与 `CSRF_INVALID` 分别处理：前者回到登录边界，后者显示可操作的双语错误而不清空应用身份。

## 网络暴露

- 仅 frontend 发布到 `127.0.0.1:${LOCAL_PORT}`；
- backend/db 只在 Compose internal network；
- PostgreSQL 没有宿主端口；
- cloudflared 只连接 edge network 和 frontend；
- 无需路由器端口转发；
- Quick Tunnel 把未授权请求传到 frontend 边界后再拒绝，并非让请求完全不到达本机。

loopback 和 Tunnel 降低直接暴露，但不能修复 Next.js、依赖、业务代码、Docker Desktop 或本机操作系统漏洞。

## 文件与 secret

以下路径被 Git 忽略，并必须限制权限：

| 路径 | 权限 | 内容 |
| --- | --- | --- |
| `deploy/config/deploy.env` | 600 | 数据库和可选外围门禁配置 |
| `deploy/config/seed-users.json` | 600 | 五个初始应用用户密码 |
| `deploy/backups/*.dump` | 600 | 数据库完整备份 |
| `deploy/runtime/` | 700 目录，文件私密 | 临时 curl 配置和 public URL |

Compose 通过只读 secret 挂载宿主种子文件。backend 仅在 root bootstrap 中读取该挂载，将其复制到 `/app/runtime/seed-users.json`，owner 为 `survey`、mode 为 600，然后通过 `gosu` 永久降权到 UID 10001。该容器内副本供 Alembic 后的种子同步读取，入口脚本不会显式删除它；该副本在容器被替换或删除时才随容器可写层一起消失。Uvicorn 及种子同步都在降权后运行，frontend runtime 也使用非 root 用户。

## 数据保留与破坏性操作

普通 restart、build/up、失败回滚和 `npm run docker:down` 都保留 PostgreSQL named volume。只有显式 `down --volumes` 删除数据库数据；该命令必须和日常操作分开，并在执行前完成可恢复备份。

恢复会改写目标数据库。脚本要求非空 mode-600 custom-format 备份、私密配置/seed 和显式 `--confirm`，拒绝系统库；操作者仍需核对 `COMPOSE_PROJECT_NAME` 与 `POSTGRES_DB`。取得维护锁后，以已检查镜像 ID 创建无网络、只读根文件系统的临时容器，执行无数据库的 Pydantic seed/恢复契约验证，seed 仍只读挂载且宿主权限不变。只有镜像、seed、归档/目标均通过，才停止应用；导入前重查服务状态，然后事务导入、迁移/seed、启动/health。停止后的失败不自动恢复服务；成功后公网入口仍停止。迁移/seed 不与导入共享事务，不能假定后续失败会整体回滚。

维护锁的 700 目录和私密 owner/token 位于 `/tmp/survey-maintenance-<UID>/<project>.lock`；同一 OS 用户的支持脚本在整个恢复/启动期间互斥，退出时核对 token 后才释放。遗留或异常锁 fail closed，须核对原进程与 Docker 子任务后人工隔离。它不能约束直接 Docker/DB 命令、镜像重标记或其他 OS 用户；这些操作须在维护窗口协调停止。

## 日志与敏感内容

应用日志可以记录错误码、资源 ID 和请求关联 ID，不应记录密码、原始 session/CSRF token 或完整敏感回答。共享日志前先检查：

```bash
docker compose --env-file deploy/config/deploy.env logs --no-color
```

不要把私密 env、seed、curl config 或备份加入诊断附件。

## 安全事件处理

1. 关闭公网与核心服务：`npm run docker:down`；
2. 运行 `npm run docker:status` 查看 Compose `ps`；只有命令成功且服务列表为空时，才能据此确认没有运行中的项目服务，`Local URL` 行不是健康证据；
3. 若怀疑数据受损，先保留现场和离线备份，不要清卷；
4. 轮换受影响的应用密码；启用外围门禁时同时轮换其密码；
5. 检查容器日志、数据库会话和异常导出记录；
6. 修复后重建镜像并重新启动；public profile 会获得新临时 URL；
7. 验证旧会话失效和跨用户隔离。

不要使用宽泛的 `pkill`、`docker system prune --volumes` 或未经确认的 `down -v` 处理事件；它们可能影响其他服务或破坏证据和数据。

## 不在保证范围内

- Quick Tunnel 固定地址、SLA 或生产 DDoS/访问控制；
- 注册、MFA、账号锁定、审计后台或组织级权限；
- 本地恶意软件、已取得 Docker/主机权限的攻击者；
- 真实 AI 模型或真实调研数据的合规治理；
- 多 backend worker 的分布式任务安全和生产 SLA。
