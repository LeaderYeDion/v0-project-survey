# Docker 部署故障排查

## Docker CLI 存在，但 daemon 不可用

先区分 client、socket 权限和 engine 就绪状态：

```bash
docker version
docker desktop status
docker info
```

常见表现：

- `permission denied ... docker.sock`：当前进程无权访问 Docker socket；
- 只显示 Client 信息：daemon 没有响应；
- Engine API `/info` 500：Docker Desktop engine 未就绪或异常；
- `docker desktop status` 长时间为 `starting`：等待有限时间后应重启 Docker Desktop，而不是让构建无限挂起。

macOS 可从 Docker Desktop 菜单执行 Restart；CLI 支持时也可运行：

```bash
docker desktop restart
docker desktop status
docker info
```

仍失败时退出并重新打开 Docker Desktop，检查磁盘空间、Docker Desktop diagnostics 和宿主日志。只有 `docker info` 返回 Server 信息后，才继续：

```bash
npm run docker:build
npm run docker:up
```

`docker compose config --quiet` 只解析配置，不访问 daemon；它成功不能证明镜像、容器、数据库或 volume 可用。

## 正确解读状态输出

`npm run docker:status` 报告 Compose `ps`/health、配置的本地 URL、已保存的 public URL、按 Compose label 查到的数据库 volume，以及运行中 backend 的 Alembic revision。它不打印或独立验证 `COMPOSE_PROJECT_NAME`/`POSTGRES_DB`。其中 `Local URL` 行只是配置地址，不是 HTTP 可达或登录成功的证明；脚本也不会执行业务登录。daemon 或 `compose ps` 失败时，命令会在输出其余状态前失败退出。

如需证明应用可达，在状态命令成功后再执行[RUNBOOK 中基于私密配置的健康请求](./RUNBOOK.md#5-状态健康与日志)；它同时适用于开启或关闭外围认证的部署。

## 缺少或过时的私密配置

创建缺少的当前 Compose 配置：

```bash
npm run docker:init
chmod 600 deploy/config/deploy.env deploy/config/seed-users.json
```

旧 host-process `deploy.env` 可能只有 `LOCAL_HOST`、`BACKEND_PORT`、`SURVEY_BACKEND_URL` 等字段。因为初始化不会覆盖已有凭据文件，应先保留旧文件：

```bash
mv deploy/config/deploy.env deploy/config/deploy.env.pre-compose
npm run docker:init
```

新文件必须包含有效 `COMPOSE_PROJECT_NAME`、`LOCAL_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、至少 20 个 URL-safe 字符的非示例 `POSTGRES_PASSWORD`、布尔 `SIMULATION_TERMINATION_ENABLED` 和 `DEPLOY_AUTH_ENABLED`。

## 私密文件权限错误

脚本严格要求普通文件和 mode 600：

```bash
chmod 600 deploy/config/deploy.env
chmod 600 deploy/config/seed-users.json
chmod 600 deploy/backups/<backup>.dump
```

不要通过放宽到 644 解决容器读取问题。backend 的 root bootstrap 会把只读 secret 安全复制为 UID 10001 可读的容器内 mode-600 文件。

## 端口 3000 被占用

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

确认进程身份并使用该服务自己的停止方法，不要宽泛 kill。也可修改私密配置中的 `LOCAL_PORT` 为 1024–65535 的空闲端口，再重新启动。backend 和 db 不应有宿主端口冲突，因为它们不发布端口。

## db 不健康

```bash
npm run docker:status
docker compose --env-file deploy/config/deploy.env logs --no-color db
```

检查：

- `POSTGRES_DB`/`POSTGRES_USER` 是否是合法 identifier；
- 密码是否为非示例、URL-safe 的强随机值；
- volume 所在磁盘是否有空间；
- 是否修改了现有 volume 的数据库用户/库名，使配置与已有 cluster 不一致。

不要用 `down -v` 作为第一反应。已有数据时先备份和确认 volume。

## backend 不健康或 migration_pending

```bash
docker compose --env-file deploy/config/deploy.env logs --no-color backend
docker compose --env-file deploy/config/deploy.env exec backend alembic current
```

backend 只有在数据库可达并且 revision 等于应用期望 head 时才健康。重点检查 Alembic 错误、seed 文件读取/格式、数据库权限和网络。种子文件必须恰好包含 `researcher01`–`researcher05`，每项 locale 为 `zh-CN`。

如果日志显示 bootstrap UID/secret 错误，不要修改镜像为长期 root 或放宽宿主 secret；重新构建当前 backend image 并检查 Compose secret source：

```bash
npm run docker:build
npm run docker:up -- --no-build
```

## frontend 健康，但业务登录失败

仅在 `DEPLOY_AUTH_ENABLED=false` 时，可用无凭据 curl 确认同源 backend 健康：

```bash
curl --fail http://127.0.0.1:3000/survey-api/health
```

启用外围认证时，使用[RUNBOOK 中基于私密配置的 curl config](./RUNBOOK.md#5-状态健康与日志)，不要把外围密码写进命令行。

应用登录必须使用 `deploy/config/seed-users.json` 中的 `researcher0N`，不是可选的外围 `DEPLOY_USERNAME`。如果用户已存在，修改 seed 文件不会覆盖数据库密码；使用 backend CLI 显式 reset-password。

登录成功后又返回登录页时，检查浏览器是否允许 Cookie、主机名/协议是否变化、会话是否过期/撤销，以及代理是否正确转发 Host/Proto。状态变更 403 `CSRF_INVALID` 通常表示 CSRF Cookie/header 或 Origin/forwarded Host 不一致。

## 跨用户访问返回 404

这是预期的防泄露行为。当前用户既无法列出他人资源，也无法用已知 ID 直接打开；missing 和 cross-owner 都返回 `RESOURCE_NOT_FOUND`。先通过 `/survey-api/auth/me` 确认当前用户，再选择属于该用户的项目。

## backend restart 后活动轮次 paused

这是预期恢复语义。优雅关闭或下一次启动对账会把本执行器持有/失租的活动轮次转为 paused；用户需要显式继续。已提交检查点和历史结果不应消失。若轮次不可读取，检查数据库/volume，而不是重新运行并覆盖来源。

## 普通 down/up 后看不到数据

```bash
npm run docker:status
docker volume ls --filter label=com.docker.compose.project=<project-name>
```

确认 `COMPOSE_PROJECT_NAME` 与原部署一致。更换 project name 会使用另一组 Compose 资源，看起来像数据丢失。不要删除任何 volume；恢复原 project name 或明确从备份恢复。

## 备份失败或为空

```bash
npm run docker:status
docker compose --env-file deploy/config/deploy.env logs --no-color db
npm run docker:backup
```

备份要求运行中的 db、可访问的目标库和可写 `deploy/backups/`。脚本不会保留空临时文件。不要手工把空文件当成有效备份。

## 恢复被拒绝

恢复要求两个参数、非空 mode-600 文件和精确 `--confirm`：

```bash
npm run docker:restore -- deploy/backups/<backup>.dump --confirm
```

执行前，用可信的本地编辑器打开 mode-600 `deploy/config/deploy.env`，人工核对 `COMPOSE_PROJECT_NAME` 和 `POSTGRES_DB`；不要为了核对而把包含密码的整个文件打印到共享终端或日志。`docker:status` 不打印这两个字段，不能代替该核对。`pg_restore --clean` 会改写目标；需要演练时使用隔离 Compose project/database，不要在主数据库试错。

## Quick Tunnel 没有 URL 或返回 502

```bash
npm run docker:status
docker compose --env-file deploy/config/deploy.env --profile public logs --no-color cloudflared
```

检查网络、VPN、代理、防火墙、Cloudflare 可达性和 frontend health。镜像固定为审核过的 `cloudflare/cloudflared:2026.8.3`。Quick Tunnel 不要求 `tunnel login`、域名或端口转发。

如果本地 health 通过但公网失败，记录精确 cloudflared 错误并把公网验收标记为未通过/未执行；不要用配置契约代替真实 HTTPS 验证。

## 生产构建在 sandbox 中卡住

Turbopack 可能需要创建 helper process/绑定内部端口。若构建长时间无进展，应有界终止后，在允许该行为的环境原样重跑 `npm run build`。当前项目还会输出已有自定义 Babel 配置警告并提示 Next 内置类型检查被跳过，因此必须单独执行：

```bash
npm run typecheck
npm run build
```

## 仍无法定位

保存以下非敏感输出：

```bash
docker version
docker desktop status
npm run docker:status
docker compose --env-file deploy/config/deploy.env config --quiet
```

日志共享前删除密码、Cookie、token、完整回答和私密文件内容。不要上传 `deploy.env`、`seed-users.json` 或备份。
