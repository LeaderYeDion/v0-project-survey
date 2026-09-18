# Docker / macOS 部署导航

当前部署由 Docker Compose 管理三个核心服务：`frontend`（Next.js）、`backend`（FastAPI）和 `db`（PostgreSQL 17）。可选 `cloudflared` 位于 `public` profile。宿主机只发布 `127.0.0.1:${LOCAL_PORT}:3000`；backend 和 db 不发布宿主端口。

> 验证状态：2026-09-18 部署契约 60/60、shell 语法和 Compose 模型通过；恢复整改仍待最终静态审查。image build、live PostgreSQL、volume 持久化、真实备份恢复和公网入口仍待现场验收。

## 快速开始

```bash
docker info
npm run docker:init
npm run docker:build
npm run docker:up
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用 `deploy/config/seed-users.json` 中 `researcher01`–`researcher05` 任一账号登录。两个生成文件都被 Git 忽略并必须保持 mode 600：

- `deploy/config/deploy.env`
- `deploy/config/seed-users.json`

如果 `docker info` 没有 Server 区域或一直停在 starting，先按[故障排查](./TROUBLESHOOTING.md)恢复 daemon，不要继续把 `docker compose config` 的成功当成容器可运行。

## 认证模型

五个应用用户是研究数据归属的唯一业务身份。登录后 FastAPI 使用数据库会话、CSRF 和 owner-scoped 查询保护项目、问卷、轮次、分析和导出。

`DEPLOY_AUTH_ENABLED=true` 可增加一个外围共享门禁，默认关闭。外围门禁只能阻止未授权请求进入 frontend；它不会创建应用 `CurrentUser`，也不能代替五个应用用户登录或绕过所有权。

启用后 `/login` 先显示部署访问表单，验证签名 Cookie 后清空凭据并显示研究账号表单。应用身份只由第二步的 FastAPI 会话建立；外围会话失效会返回该登录边界。

## 数据生命周期

- `docker compose restart`：保留 PostgreSQL named volume；
- 重新构建/替换 frontend 或 backend 容器：保留 volume；
- `npm run docker:down`：普通停止，保留 volume；
- `docker compose ... down --volumes`：破坏性清库，删除 volume。

普通停止：

```bash
npm run docker:down
```

备份与显式恢复：

```bash
npm run docker:backup
npm run docker:restore -- deploy/backups/<backup>.dump --confirm
```

备份是 PostgreSQL custom-format、无 owner/privilege 的 mode-600 文件。恢复要求运行中的 db 和已构建的当前镜像；先验证归档/目标，再停止 cloudflared/frontend/backend，以 `--single-transaction --clean --if-exists --exit-on-error` 恢复。随后独立执行迁移至 `20260912_0002` 和五用户幂等 seed，再重启应用并检查健康。失败保持应用停止，按输出的精确命令修复重试；成功后公网入口仍保持停止。详见 RUNBOOK 第 8 节。

## 日常命令

```bash
npm run docker:init       # 创建缺少的私密配置，不覆盖有效现有文件
npm run docker:build      # 构建 frontend/backend 镜像
npm run docker:up         # 构建并启动三个核心服务，等待健康
npm run docker:status     # 容器健康、URL、volume、迁移 revision
npm run docker:health     # 使用私密配置安全请求同源 health
npm run docker:logs       # 跟随 Compose 日志
npm run docker:backup     # 创建私密 pg_dump custom-format 备份
npm run docker:down       # 普通停止，保留数据库 volume
```

可选公网入口：

```bash
npm run docker:up -- --public
```

跳过重复 build：

```bash
npm run docker:up -- --no-build
```

## 文档导航

- [RUNBOOK](./RUNBOOK.md)：首次部署、日常启停、升级、备份恢复、清库和验收
- [ARCHITECTURE](./ARCHITECTURE.md)：服务、网络、身份、持久化和恢复语义
- [SECURITY](./SECURITY.md)：会话、CSRF、所有权、secret、容器权限和事件处理
- [TROUBLESHOOTING](./TROUBLESHOOTING.md)：Docker、配置、健康、迁移、登录、数据和 Tunnel 故障
- [P0 验证记录](../docs/verification/2026-09-05-p0-verification.md)：已经执行与仍待执行的证据

## 当前限制

- Quick Tunnel 使用随机 `trycloudflare.com` 地址，无固定域名或正式 SLA。
- 系统仍使用 Mock Engine，不提供真实 AI 或正式研究结论。
- 本轮没有注册、项目共享、角色管理、审计后台或独立任务 Worker。
- Docker Desktop/engine 是本地部署的必要前提；只有 CLI 配置渲染成功不能证明 daemon、volume 或数据库正常。
