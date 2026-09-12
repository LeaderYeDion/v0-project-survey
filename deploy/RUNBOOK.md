# Docker / macOS 操作手册

## 1. 前置条件

- macOS 上已安装并启动 Docker Desktop；
- `docker compose version` 可用；
- Node.js/npm 已安装；
- 仓库依赖已通过 `npm install` 或 `npm ci` 安装；
- 本地端口（默认 3000）未被其他服务占用。

先确认真正的 daemon 就绪，而不只确认 Docker CLI 存在：

```bash
docker version
docker compose version
docker info
```

`docker info` 必须返回 Server 信息。若 permission denied、Engine API 500、只显示 client，或 Docker Desktop 长时间为 `starting`，转到[故障排查](./TROUBLESHOOTING.md)。

## 2. 初始化私密配置

```bash
npm run docker:init
```

脚本创建缺少的文件，但不覆盖任何已有私密文件：

```text
deploy/config/deploy.env
deploy/config/seed-users.json
```

两个文件必须是普通文件、权限严格为 `600`。种子文件包含五个名称固定、密码独立随机生成的用户：`researcher01` 到 `researcher05`。

```bash
chmod 600 deploy/config/deploy.env deploy/config/seed-users.json
```

如果仓库从 2026-07 的 host-process 部署升级，旧 `deploy.env` 可能含 `LOCAL_HOST`、`BACKEND_PORT` 等字段而缺少 PostgreSQL/Compose 字段。初始化会保护已有文件而不会重写它；先安全保留旧文件，再重新初始化：

```bash
mv deploy/config/deploy.env deploy/config/deploy.env.pre-compose
npm run docker:init
```

确认新文件至少包含 `COMPOSE_PROJECT_NAME`、`LOCAL_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、强随机 `POSTGRES_PASSWORD`、`SIMULATION_TERMINATION_ENABLED` 和 `DEPLOY_AUTH_ENABLED`。不要把密码输出到聊天、日志或 Git。

## 3. 构建与启动

单独构建：

```bash
npm run docker:build
```

构建并启动三个核心服务：

```bash
npm run docker:up
```

启动脚本会校验 Docker/Compose 和私密文件，构建镜像，依次等待 db、backend、frontend 健康，然后请求同源 `/survey-api/health`。任何部分启动失败都会执行普通 Compose down，不删除 volume。

已构建镜像时：

```bash
npm run docker:up -- --no-build
```

同时启动可选 Quick Tunnel：

```bash
npm run docker:up -- --public
```

启动成功后本地地址为 `http://127.0.0.1:${LOCAL_PORT}`（默认 3000）。public profile 成功时脚本打印并保存本轮随机 HTTPS 地址。

## 4. 首次登录和五账号

用安全编辑器查看 `deploy/config/seed-users.json`，选择 `researcher01`–`researcher05` 任一账号登录。不要把完整文件粘贴到终端输出或共享记录。

backend 每次启动都会执行幂等种子同步：

- 缺少的固定用户会创建；
- 已存在用户保留数据库中的密码 hash 和 locale；
- 修改 seed 文件不会自动重置已存在用户密码；
- 数据库不保存明文密码。

重置一个账号时在运行中的 backend 容器执行 CLI。避免把密码留在 shell 历史；以下交互读取方式仍会把值短暂传给容器进程参数，应仅在可信本机使用：

```bash
read -r -s reset_password
docker compose --env-file deploy/config/deploy.env exec backend \
  python -m app.cli reset-password \
  --username researcher01 \
  --password "$reset_password"
unset reset_password
```

## 5. 状态、健康与日志

```bash
npm run docker:status
npm run docker:logs
```

状态脚本显示：

- Compose 服务和 health；
- 本地 URL；
- public URL（如启用）；
- 带 Compose label 的数据库 volume；
- backend 的当前 Alembic revision。

只检查本地同源健康：

```bash
curl --fail http://127.0.0.1:3000/survey-api/health
```

如果启用了外围认证，健康请求必须携带外围凭据；应用业务接口仍需 `researcher0N` 会话。

## 6. 普通停止、重启与升级

普通停止：

```bash
npm run docker:down
```

实现等价于带 `public` profile 的 `docker compose down --remove-orphans`，不带 `-v`/`--volumes`，因此保留 PostgreSQL volume。

普通容器重启：

```bash
docker compose --env-file deploy/config/deploy.env restart backend
```

升级前先备份，然后构建并重新启动；backend 启动时自动执行 Alembic upgrade：

```bash
npm run docker:backup
npm run docker:build
npm run docker:up -- --no-build
```

不要在没有备份和迁移审查的情况下对重要数据升级。

## 7. 备份

数据库必须运行且健康：

```bash
npm run docker:backup
```

脚本在 db 容器中执行：

```text
pg_dump --format=custom --no-owner --no-privileges
```

先写入 mode-600 临时文件，确认非空后原子移动到 `deploy/backups/`。输出的最终路径类似：

```text
deploy/backups/survey-survey-YYYYMMDDTHHMMSSZ-<pid>.dump
```

把备份复制到受控的加密存储，并定期执行隔离恢复演练。仅“生成了文件”不能证明它可恢复。

## 8. 恢复

恢复会清理并改写当前 `deploy.env` 指向的应用数据库。先检查目标项目、数据库和备份权限：

```bash
chmod 600 deploy/backups/<backup>.dump
npm run docker:status
npm run docker:restore -- deploy/backups/<backup>.dump --confirm
```

脚本拒绝缺少 `--confirm`、缺失、空或非 mode-600 文件；实际使用 `pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges`。恢复后再次检查 health、迁移 revision、用户和项目数据。

## 9. 持久化验收

daemon 就绪后执行仓库提供的 live smoke：

```bash
npm run docker:up
bash deploy/tests/persistence-smoke.sh
```

脚本覆盖两个用户、跨用户列表/直接访问、项目/问卷/轮次、backend restart、普通 down/up、非空备份和随机隔离 Compose 项目中的恢复。它仅对生成的隔离项目使用 `down --volumes`；不会删除主部署 volume。

## 10. 明确清库（破坏性）

以下命令不可恢复地删除当前 Compose 项目的 PostgreSQL volume。先运行备份并确认 `COMPOSE_PROJECT_NAME`：

```bash
docker compose \
  --env-file deploy/config/deploy.env \
  --profile public \
  down --volumes --remove-orphans
```

日常停止、重启、升级和失败回滚都不应使用 `--volumes`。

## 11. 完整验收交接

执行持久化 smoke 后，继续按[P0 验证记录](../docs/verification/2026-09-05-p0-verification.md)验证五账号登出/401、五视口工作流、分析/异常/导出和可选 Quick Tunnel。所有条件通过前，不把完整 P0 标为完成。
