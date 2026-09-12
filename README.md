# Survey Agent Simulator

一个面向产品与研究团队的 Mock 调研平台，用于验证“项目—问卷—配置版本—研究轮次—分析—导出”的完整工作流。系统已经实现应用用户、严格的数据归属、PostgreSQL 持久化、可恢复运行控制和三服务 Docker 部署；回答与推断仍由 Mock Engine 生成，不代表真实 AI 或真实研究结论。

## 当前状态

- P0-A 响应式工作区已经完成并有历史浏览器证据。
- P0-B/P0-C 的代码实现完成，已执行的非 Docker 自动化/静态检查通过；完整验证矩阵尚未完成。
- 完整 P0 验收仍待 Docker daemon 可用后执行：真实 PostgreSQL 迁移与持久化、五账号隔离、备份/隔离恢复、后端重启与普通 down/up、五视口浏览器流程及可选 Quick Tunnel。

因此，本仓库当前状态是“实现完成，现场验收待补”，不是“完整 P0 已完成”。详细证据和待执行命令见 [P0 验证记录](./docs/verification/2026-09-05-p0-verification.md)。

## 已实现能力

- 预置 `researcher01` 至 `researcher05` 五个应用账号；不提供注册、找回密码或产品内用户管理。
- 项目、问卷、不可变问卷版本、不可变完整配置版本、研究轮次、结果与导出记录都通过当前应用用户归属；跨用户直接访问按不存在处理并返回 `404 RESOURCE_NOT_FOUND`。
- 问卷草稿使用 revision 乐观并发和自动保存；开始运行时固化配置，之后修改草稿不会改变历史轮次。
- 研究轮次支持暂停、继续、取消、重试失败样本、重试未完成样本，以及从历史复制为新草稿；原轮次和原版本保持不变。
- 分析明确显示总体、当前筛选、有效回答、排除数量和分组人数；有效样本少于 30 时显示探索性提示；终止/失败可下钻到受访者证据。
- JSON/CSV 导出支持 `full`、`filtered`、`exceptions` 三种范围、服务端安全文件名和可追溯的处理/成功/失败记录。
- `zh-CN`/`en-US` 双语界面以及 390、768、1024、1280、1440 px 三段式响应式工作区。

## 架构

```text
浏览器
  │ 同源页面、应用会话 Cookie、CSRF
  ▼
frontend（Next.js，唯一绑定 127.0.0.1 的服务）
  │ /survey-api/*，Compose 内部网络
  ▼
backend（FastAPI，迁移、种子、Mock 执行与业务所有权）
  │ PostgreSQL 事务
  ▼
db（PostgreSQL 17）
  │
  ▼
survey_postgres_data named volume
```

可选 `cloudflared` 服务位于 `public` profile，只连接 frontend。可选的外围共享认证默认关闭；即使启用，也不能代替五个应用用户的业务身份。

## Docker 快速开始（推荐）

前提：Docker Desktop 已经启动，且 `docker info` 能正常返回服务端信息。

```bash
npm install
npm run docker:init
npm run docker:build
npm run docker:up
```

初始化会生成两个 Git 忽略、权限为 `600` 的私密文件：

- `deploy/config/deploy.env`：Compose、数据库和可选外围认证配置；
- `deploy/config/seed-users.json`：五个预置应用账号的初始密码。

浏览器访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用种子文件中的任一账号登录。后端启动时依次执行 Alembic 迁移和幂等种子同步；已存在用户的密码不会因重启而被重置。

```bash
npm run docker:status
npm run docker:logs
npm run docker:backup
npm run docker:down
```

`npm run docker:down` 是普通停止，不删除数据库 volume。`docker compose down -v` 会永久删除数据库数据，只能在明确清库时使用。恢复备份会覆盖目标应用数据库，必须显式确认：

```bash
npm run docker:restore -- deploy/backups/<backup>.dump --confirm
```

完整操作、升级、备份恢复和公网入口见 [部署手册](./deploy/README.md)。

## 非 Docker 开发

前端和后端仍可分别启动，但完整应用登录与持久化流程需要可用 PostgreSQL 和 `DATABASE_URL=postgresql+asyncpg://...`：

```bash
bash backend/scripts/bootstrap.sh
npm run dev:backend
npm run dev
```

默认地址为 `http://127.0.0.1:8000` 和 `http://127.0.0.1:3000`。没有数据库配置时只保留部分纯 Mock/测试组合，应用用户登录不可用；日常完整体验应使用 Compose。

## 验证

```bash
backend/.venv/bin/python -m pytest backend/tests -q
npm run test:frontend
npm run typecheck
npm run build
node --test deploy/tests/*.test.mjs
bash -n deploy/scripts/*.sh backend/docker-entrypoint.sh
docker compose config --quiet
```

2026-09-09 实际执行并于 2026-09-11 复验的非 Docker 自动化/静态子矩阵为后端 127/127、前端 114/114、部署契约 42/42，类型检查、Next.js 生产构建、shell 语法和 Compose 配置模型检查均通过。`docker compose build`、live Compose/PostgreSQL 和 Playwright 五视口验收因本机 daemon 无法在有界检查内就绪而未执行；因此完整验证矩阵仍是 pending，不能由这些结果替代。

## 明确边界

- Mock Engine、Mock 推断和样例回答仅适合流程验证、演示、预实验和假设生成。
- 不提供真实 AI、真实受访者、代表性抽样或正式研究结论。
- 不提供注册、项目共享、角色/管理员跨用户读取、审计后台、Redis/Celery 或固定公网 SLA。
- Quick Tunnel 地址临时且可能受网络或 Cloudflare 服务限制，不是生产部署。

## 文档

- [项目迭代台账](./docs/PROJECT_ITERATION.md)
- [验证记录](./docs/verification/2026-09-05-p0-verification.md)
- [部署导航](./deploy/README.md)
- [后端开发说明](./backend/README.md)

历史评估文档保留当时事实，不承担实时状态维护。功能、架构、运行命令或验收状态变化时，应在同一变更中更新 README、项目迭代台账和相应运行手册。

## 构建于 v0

本仓库已连接至 [v0](https://v0.app) 项目；推送到配置的发布分支可能触发部署。任何托管环境仍需单独提供 PostgreSQL、私密配置和迁移/种子流程。
