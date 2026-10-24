# Survey Agent Simulator

一个面向公共政策科研的 LLM 调研模拟系统，目标是通过问卷和访谈两种模式模拟不同人群的反馈，帮助科研人员形成假设、优化实际调研方向、减轻前期数据收集负担。计划支持公有云模型 API 和本地 GPU 模型服务两条推理路径。

当前已经实现“项目—问卷—配置版本—研究轮次—分析—导出”的业务工作流，以及用户隔离、PostgreSQL 持久化和三服务 Docker 部署；**默认保留 Mock Demo，已实现异步 HTTP 回答接入并通过测试端点闭环；实际云端/GPU 模型仍待资源到位后验收**。即使接入 LLM，产出也属于合成模拟数据，不等于真实民意、代表性抽样或正式实证结论。

## 当前阶段与下一步目标（2026-10-10）

当前处于 Demo 阶段，业务 API、用户隔离、持久化、历史和结果展示已有底座，HTTP 回答适配已完成。**下一版最高优先级是接入一个真实 LLM 端点，把基础链路完整跑通。**

```text
登录/选择语言 → 配置角色与问卷/访谈提纲 → 真实 LLM 产出回答
→ 页面展示 → PostgreSQL 保存 → 刷新/重新进入后查看历史问卷与结果
```

已按 [API Key/GPU 到位前改动与验收清单 A0–A7](./docs/PRE_LLM_MAINLINE_CHECKLIST.md) 完成代码接入和受控端点闭环，保留默认 Mock Demo、辅助模拟能力和旧历史兼容。下一步按 [模型接入说明](./docs/LLM_CONNECTION.md) 配置一个实际端点，再完成真实模型验收。

具体按 [项目迭代台账的 M0–M6](./docs/PROJECT_ITERATION.md#当前最高优先级p0-主线闭环--next-todo) 执行：

1. 保证应用可启动、必需模板随交付提供；选择一个可用的云 API 或本地模型端点，配置后端访问。
2. 沿用登录、中英文和现有角色/题型配置，保证开始运行使用最新已保存配置。
3. 接入异步真实回答，将角色、研究背景、题目约束、语言及访谈历史传给模型，校验基础答案结构。
4. 在现有页面展示真实结果与基本状态，处理实际调用的等待/超时；未接入的辅助推断/情绪分析关闭或明确未启用。
5. 沿用数据库保存问卷/角色快照、轮次、回答/对话与来源；刷新后恢复同一问卷和结果，重新登录后可从历史打开。
6. 一个真实端点上完成问卷、固定提纲访谈、中英文和真实 DB/浏览器闭环，达到验收脚本即结束本版。

云端与本地双来源仍是项目目标；本版先验证先到位的一种，不等待两者同时完成。固定角色维度、text/choice/scale（单选）和现有执行器继续使用。完整调用账本、任务级推断重试、五账号×五视口矩阵、规模化与正式运维放到后续阶段。仅当问题阻断主线或导致错误保存、串用户、历史丢失时，才纳入本版修复。

本版完成表示 **Demo 真实主线可运行、可保存、可回看**，不表示正式生产上线。当前尚未完成真实模型接入。

本轮证据见 [资源到位前验收报告](./docs/verification/2026-10-10-pre-llm-mainline.md)。模板 JSON 已纳入交付；HTTP 来源/model、研究背景随轮次保存，迁移 head 为 `20260927_0003`。默认 Mock 与 HTTP 均使用原执行器，无新增 Agent 框架。

## 既有 P0 实现总结（截至 2026-09-19）

- **数据与迁移**：引入 SQLAlchemy/asyncpg/Alembic 持久化层，建立用户、会话、项目、问卷、不可变版本、研究轮次、回答/推断、消息与导出记录；当前迁移 head 为 `20260912_0002`。
- **身份与隔离**：建立应用用户模型、数据库会话和 CSRF；部署时严格初始化 `researcher01`–`researcher05` 五个用户，无注册入口。项目作为所有权根，所有研究数据按当前用户隔离。
- **可信研究流程**：问卷草稿支持 revision 冲突保护和自动保存；运行时固化不可变问卷/配置版本；研究轮次支持检查点、租约、暂停、继续、取消、失败/未完成重试与历史复制。
- **分析与导出**：统一总体、筛选、有效、排除和分组口径，提供异常证据下钻；JSON/CSV 支持 `full`、`filtered`、`exceptions` 三种范围，并保存稳定的配置、轮次、推断和处理状态元数据。
- **前端可靠性**：接入真实应用登录与 owner-scoped API，分离可选外围门禁和研究账号；补齐双语 CSRF 错误、资源切换取消/代际保护、历史轮次独立状态和持久化工作区。
- **Docker 与运维**：建立 frontend、backend、db 三服务 Compose，PostgreSQL 使用 named volume；补齐私密配置生成、健康检查、普通启停、备份、显式恢复和可选 Quick Tunnel。
- **恢复安全与最终整改**：恢复流程加入镜像/严格五用户 seed 的无数据库预检、共享维护锁、写入端停机重查、事务导入、迁移/seed/health 和失败后保持停止；此前识别的存储、租约、导出和前端竞态整改已合入；本轮发现的长调用租约与结果正确性缺口另列于最新检查报告。
- **验证与审查**：非 live 自动化、类型、构建、shell 和 Compose 静态门通过；最终独立审查 Critical/Important/Minor 为 0/0/0。2026-09-19 已补主要 Docker/PostgreSQL 与部分浏览器证据，剩余矩阵和新发现问题见最新检查报告。

## 已实现能力

- 预置 `researcher01` 至 `researcher05` 五个应用账号；不提供注册、找回密码或产品内用户管理。
- 项目、问卷、不可变问卷版本、不可变完整配置版本、研究轮次、结果与导出记录都通过当前应用用户归属；跨用户直接访问按不存在处理并返回 `404 RESOURCE_NOT_FOUND`。
- 问卷草稿使用 revision 乐观并发和自动保存；开始运行时固化配置，之后修改草稿不会改变历史轮次。
- 研究轮次支持暂停、继续、取消、重试失败样本、重试未完成样本，以及从历史复制为新草稿；原轮次和原版本保持不变。
- 分析明确显示总体、当前筛选、有效回答、排除数量和分组人数；有效样本少于 30 时显示探索性提示；终止/失败可下钻到受访者证据。
- JSON/CSV 导出支持 `full`、`filtered`、`exceptions` 三种范围、服务端安全文件名和可追溯的处理/成功/失败记录。
- 导出 JSON 保存配置、口径、轮次和推断元数据；CSV 按冻结配置的题目/推断任务顺序展开。存储故障返回可识别错误，过期导出记录会转为失败。
- 项目/问卷切换会取消旧请求并拒绝过时响应；历史轮次展示自己的状态；CSRF 错误提供双语反馈。
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

可选 `cloudflared` 服务位于 `public` profile，只连接 frontend。外围共享认证默认关闭；启用后 `/login` 先完成部署访问认证，再清空输入并进入研究账号登录。外围凭据不会创建应用身份。

## Docker 快速开始（推荐）

以下默认启动 Mock 业务系统，不要求模型配置；HTTP 模式显式叠加配置，见 [模型接入说明](./docs/LLM_CONNECTION.md)。两份运行模板已纳入交付。

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

浏览器访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)，使用种子文件中的任一账号登录。后端启动时依次迁移至 `20260912_0002` 和幂等同步五个用户；已存在用户的密码不会因重启而被重置。

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

恢复前 db 必须运行、当前镜像必须已构建。恢复与 `docker:up`/`deploy:start` 共用维护锁，争用时直接拒绝操作。脚本先在无数据库网络的临时容器中验证已构建镜像的恢复契约与严格五用户 seed，再检查归档/目标；全部通过才停止应用，确认服务已停，事务恢复、迁移/种子并重启检查健康。停止后的失败会保持应用停止并打印精确重试命令；不要自行启动应用或清卷。恢复成功后公网入口仍需显式启用。直接 Docker 命令、其他 OS 用户或外部数据库写入不受该锁约束，维护期间必须停止这些操作。

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
for script in deploy/scripts/*.sh deploy/tests/*.sh backend/docker-entrypoint.sh; do bash -n "$script" || exit; done
docker compose config --quiet
```

本轮验证见 [2026-10-10 报告](./docs/verification/2026-10-10-pre-llm-mainline.md)。以下为历史证据：2026-09-19 后端 174/174、前端 138/138、部署契约 70/70；类型、本地生产构建、Docker frontend/backend 构建通过。既有 Chrome fixture 回归 4/4，另已运行真实三服务 API、持久化 smoke 和浏览器抽查。具体边界见最新检查报告；不把 fixture 或页面无溢出当作完整浏览器验收。

## 待办与验收门

整体目标为 **M0–M6 主线**；当前改动以 **[资源到位前清单 A0–A7](./docs/PRE_LLM_MAINLINE_CHECKLIST.md)** 为唯一执行与验收入口，Mock 保留并需通过兼容回归。完成真实问卷/访谈生成、数据库保存、刷新及重新登录回看后收束本版。已有账号隔离和历史快照不能退化；非阻断优化登记后续，不延长本版。

原 R0–R8 的完整准备清单及旧 P0 综合验收已按阶段拆分，不能再作为本版全量前置要求。第二来源、辅助推断、完整导出/浏览器/故障矩阵、生产依赖与运维要求在后续相应阶段处理。

## 明确边界

- Mock Engine、Mock 推断和样例回答仅适合流程验证、演示、预实验和假设生成。
- HTTP 可连接兼容的模型服务；本轮仅验证受控端点，不提供真实受访者、代表性抽样或正式研究结论。
- 不提供注册、项目共享、角色/管理员跨用户读取、审计后台、Redis/Celery 或固定公网 SLA。
- Quick Tunnel 地址临时且可能受网络或 Cloudflare 服务限制，不是生产部署。

## 文档

- [模型配置与切换](./docs/LLM_CONNECTION.md)
- [本轮验收报告](./docs/verification/2026-10-10-pre-llm-mainline.md)
- [项目迭代台账](./docs/PROJECT_ITERATION.md)
- [验证记录](./docs/verification/2026-09-05-p0-verification.md)
- [部署导航](./deploy/README.md)
- [后端开发说明](./backend/README.md)

历史评估文档保留当时事实，不承担实时状态维护。功能、架构、运行命令或验收状态变化时，应在同一变更中更新 README、项目迭代台账和相应运行手册。

## 构建于 v0

本仓库已连接至 [v0](https://v0.app) 项目；推送到配置的发布分支可能触发部署。任何托管环境仍需单独提供 PostgreSQL、私密配置和迁移/种子流程。
