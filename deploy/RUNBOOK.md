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

若启用 `DEPLOY_AUTH_ENABLED=true`，先在部署访问步骤输入 `deploy.env` 中的外围凭据；成功后表单清空，再输入研究账号。默认关闭时直接显示研究账号登录。第一步只建立外围 Cookie，不创建应用用户。

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

仅当 `DEPLOY_AUTH_ENABLED=false` 时，可直接检查本地同源健康：

```bash
curl --fail http://127.0.0.1:3000/survey-api/health
```

不论外围认证是否启用，都可从私密配置生成短生存期、mode-600 的 curl config：

```bash
npm run docker:health
```

npm script 会显式调用 Bash，因此可从 macOS 默认 zsh 直接执行，不会在 zsh 中 `source` 依赖 `BASH_SOURCE` 的 helper。脚本校验 mode-600 `deploy.env`，创建短生存期的 mode-600 curl config，并在成功、请求失败或中断时清理它。启用外围认证时，凭据只写入该 config，不进入 curl 命令行参数。
收到 HUP、INT 或 TERM 时，脚本先删除该私密 config，再分别以等价状态码 129、130 或 143 退出。

启用外围认证时，不要改用带明文密码的命令行参数；该命令会从当前 `deploy.env` 写入 curl config。应用业务接口仍需 `researcher0N` 会话。

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

升级前先备份，然后构建并重新启动；backend 启动时自动执行 Alembic upgrade 至 `20260912_0002`。0002 为已存在的 0001 数据库删除三个冗余索引并增加过期导出扫描索引，不删除数据：

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

恢复会清理并改写当前 `deploy.env` 指向的应用数据库，并暂停所有应用访问。先构建包含 `--prepare-only` 的当前镜像，保证目标 db 正在运行，再检查目标项目、数据库和备份权限：

```bash
chmod 600 deploy/backups/<backup>.dump
npm run docker:build
# 若 db 尚未运行，仅启动数据库，勿提前启动应用：
docker compose --env-file deploy/config/deploy.env up --detach --no-deps --wait db
npm run docker:status
npm run docker:restore -- deploy/backups/<backup>.dump --confirm
```

执行恢复前，用可信的本地编辑器打开 mode-600 `deploy/config/deploy.env`，人工核对 `COMPOSE_PROJECT_NAME` 和 `POSTGRES_DB`。不要把包含密码的整个文件打印到共享终端或日志。`docker:status` 不打印这两个目标字段，不能代替该配置核对。

脚本按以下顺序执行：

1. 校验 `--confirm`、普通非符号链接的 mode-600 非空 custom-format 备份、env/seed 文件、Compose 模型；拒绝 `postgres/template0/template1`。在运行中的 db 只读列出归档目录，并查询实际数据库名与配置匹配。此阶段失败不会停止应用或改写数据库。
2. 停止 cloudflared、frontend、backend，清除保存的公网 URL，仅保持 db 运行。后端停止后不再有本应用的任务/连接池写入；维护期间勿从其他终端重新启动服务或运行数据库写入工具。
3. 使用 `pg_restore --single-transaction --clean --if-exists --exit-on-error --no-owner --no-privileges` 恢复配置的应用库。导入失败会回滚该事务；后续迁移/种子是独立步骤，不能据此假定整个流程自动回滚。
4. 一次性 backend 容器执行 `--prepare-only`：私密 secret 引导、降权、`alembic upgrade head` 和严格五用户幂等同步，不启动 Uvicorn。
5. 准备成功后启动 backend/frontend、等待 Compose health，再执行带外围认证配置的同源 health。成功后人工确认项目、轮次与账号数据。cloudflared 保持停止；需要公网时显式执行 `npm run docker:up -- --public --no-build`。

从停止阶段开始的任何失败（含迁移、seed、启动或 health）都会再次停止应用并保留 db/volume，返回非零退出码，打印失败阶段及带当前目标、配置/seed/备份路径的 shell 转义重试命令。如果 Docker 本身拒绝停止，脚本会明确提示无法确认服务已停止，此时先人工确认停止状态。

失败恢复：保持应用停止，查看 db/backend 日志并修复报告的原因，按脚本打印的精确命令确认应用停止、仅启动 db（如有需要）、重跑恢复；归档不可用时仅替换成已验证的私密备份路径。沿用同一私密配置和已有的凭据环境覆盖。不要用 `docker:up` 跳过失败的恢复/迁移，也不要清卷修复。若使用自定义环境文件，启动 db 和检查日志时也必须使用同一个 `DEPLOY_ENV_FILE`/Compose project。

## 9. 持久化验收

daemon 就绪后执行仓库提供的 live smoke：

```bash
npm run docker:up
bash deploy/tests/persistence-smoke.sh
```

脚本覆盖两个用户、跨用户直接访问、项目/问卷/轮次、backend restart、普通 down/up 和非空备份。它启动随机隔离 Compose 项目中的完整应用，再调用生产恢复脚本两次，检查 0002、严格五个用户名、重新登录、原轮次 ID 与项目数量。隔离 frontend 默认使用空闲端口 3001；可用 `RESTORE_SMOKE_PORT=3002 bash deploy/tests/persistence-smoke.sh` 调整，必须不同于主应用端口。主项目创建的 smoke 数据和备份保留；仅自动生成的隔离项目在退出时使用 `down --volumes` 清理，不删除主部署 volume。该 hook 已提供，当前尚未实际执行。

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
