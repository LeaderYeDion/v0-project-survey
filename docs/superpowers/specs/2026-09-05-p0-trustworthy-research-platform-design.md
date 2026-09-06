# P0 可信、可控、可复现调研平台设计

> 日期：2026-09-05
>
> 状态：已完成对话设计确认，待书面规格复核
>
> 实施分支：`real-backend-v1`（直接在当前分支实施，不创建 worktree）

## 1. 背景与目标

当前系统已经完成响应式工作区、问卷/访谈 Mock 运行、基础分析、进程内历史和导出，但 FastAPI 重启后运行与历史会丢失，所有访问者共享同一份内存数据，也缺少项目、问卷、配置版本、研究轮次、可恢复控制和明确分析口径。

本轮完成 `docs/PROJECT_ITERATION.md` 中完整 P0，而不只完成 P0-B：

1. 建立应用用户及严格的数据归属边界；
2. 建立项目、问卷、不可变问卷版本、不可变配置版本和研究轮次；
3. 使用 PostgreSQL 持久化运行、结果、推断和导出记录；
4. 支持暂停、继续、取消、失败样本重试和取消后未完成样本重试；
5. 统一总体、筛选、分组和有效样本数口径，并支持终止/失败原因下钻；
6. 补齐配置自动保存、运行自动持久化、导出范围、文件名和成功/失败反馈；
7. 使用 Docker Compose 将前端、后端和数据库作为三个独立服务部署，并保证普通重启和容器重建不丢数据；
8. 完成自动化、数据库、Docker、浏览器和文档验证闭环。

P0 完成后，系统仍然是 Mock 调研平台，不宣称接入真实 AI，不把模拟结果描述为真实研究结论。

## 2. 已确认的产品边界

### 2.1 本轮包含

- 5 个由部署初始化脚本生成的预置账号；
- 用户名密码登录、退出和当前用户查询；
- 用户级项目、问卷、配置、轮次、结果和导出隔离；
- 项目与问卷的最小创建、选择、编辑和历史工作流；
- PostgreSQL 持久化和版本化迁移；
- 运行状态控制、检查点与后端重启后的显式恢复；
- 分析口径、有效样本数、小样本提示和异常下钻；
- Docker 本地部署、可选 Cloudflare Quick Tunnel、备份和恢复说明；
- 中英文界面和稳定错误码。

### 2.2 本轮不包含

- 用户注册、邮件验证、忘记密码、产品内用户管理后台；
- 项目共享、角色授权、跨用户协作或管理员查看所有用户数据；
- Redis、Celery 或独立任务 Worker；
- 真实 AI 模型、外部翻译服务或正式研究结论生成；
- 自定义受访者字段、交叉配额、运行前设计检查和多轮对比；
- 固定公网域名、正式生产 SLA 或云端托管数据库。

部署者在产品外分发和管理 5 个账号。即使某个预置用户名称为管理员用途，本轮 API 也不提供绕过所有权的全局数据读取能力。

## 3. 方案选择

采用 PostgreSQL + FastAPI 内置异步执行器 + Next.js：

- PostgreSQL 提供独立数据库服务、事务、约束、版本迁移和 Docker volume 持久性；
- FastAPI 保持当前 Mock 执行边界，通过数据库检查点和执行租约增强可恢复性；
- Next.js 继续通过同源 `/survey-api/*` 访问 FastAPI，浏览器不直接连接数据库或后端容器；
- P0 不引入 Redis/Celery，避免在当前 Mock 负载下增加两个无必要服务；
- 不使用 SQLite，因为它不能满足“DB 独立部署”的要求。

## 4. 部署架构与持久化路径

```text
浏览器
  │ HTTP/HTTPS + 应用会话 Cookie
  ▼
frontend 容器（Next.js）
  │ /survey-api/*，Compose 内部网络
  ▼
backend 容器（FastAPI）
  │ PostgreSQL 事务
  ▼
db 容器（PostgreSQL）
  │ PGDATA
  ▼
survey_postgres_data named volume
```

核心 Compose 服务：

- `frontend`：独立 Dockerfile 和健康检查，只依赖后端 HTTP 契约；默认绑定 `127.0.0.1:3000`；
- `backend`：独立 Dockerfile，启动时先执行迁移和预置用户同步，再启动 Uvicorn；默认只在 Compose 网络提供 `8000`；
- `db`：PostgreSQL 17 Alpine，健康检查使用 `pg_isready`，数据目录挂载 `survey_postgres_data`；
- `cloudflared`：可选 `public` profile，只把 Quick Tunnel 指向 `frontend:3000`，不属于三个核心服务。

`docker compose restart`、容器重建和普通 `docker compose down` 保留 named volume。只有明确执行 `docker compose down -v` 才删除数据库数据；部署文档必须把该命令标记为破坏性操作。

部署手册提供：初始化、构建、启动、状态、日志、停止、升级迁移、`pg_dump` 备份、恢复、密码重置和彻底清库命令。所有涉及删除卷的命令都与日常命令分离。

## 5. 身份、会话与数据隔离

### 5.1 预置账号

`deploy:init` 生成 5 个用户名和随机初始密码，写入 Git 忽略且文件权限为 `600` 的 `deploy/config/seed-users.json`。默认用户名为 `researcher01` 至 `researcher05`；初始化脚本打印凭据文件位置，不把密码写入 Git 或普通运行日志。

后端容器启动时执行幂等种子命令：

- 数据库缺少用户时创建；
- 已存在用户不因容器重启重置密码；
- 数据库只保存 Argon2id 哈希，不保存明文；
- 明文初始密码只存在部署者本地的私密种子文件；
- 运维命令可以为单个预置用户设置新密码。

本轮不提供注册 API 和注册页面。

### 5.2 会话

登录成功后，后端生成至少 256 bit 的随机会话令牌。浏览器 Cookie 保存原始令牌，数据库只保存令牌哈希。Cookie 使用 `HttpOnly`、`SameSite=Strict` 和 `Path=/`；通过 HTTPS 访问时增加 `Secure`。退出时撤销数据库会话并清除 Cookie。

状态变更请求使用双提交 CSRF Cookie 与自定义请求头；后端同时验证请求 Origin 与当前转发 Host。认证令牌不得写入 `localStorage` 或 `sessionStorage`。

### 5.3 所有权规则

所有顶层研究资源都通过 `projects.owner_user_id` 归属用户。API 不接受客户端传入任意 `user_id`，而是从服务端会话解析当前用户。列表查询必须按所有者过滤；单资源读取、更新、控制、分析和导出必须在 SQL 或仓储入口同时限定资源 ID 与所有者。

跨用户访问统一返回 `404 RESOURCE_NOT_FOUND`，避免泄露其他用户资源是否存在。子资源通过外键和父资源所有权关联，不提供绕开项目所有权的直接访问路径。

原有 Cloudflare 共享账号认证不再承担业务身份。它可以作为可选外围门禁保留，但默认业务隔离只信任应用用户会话。

## 6. 数据模型

所有主键使用 UUID，时间使用带时区的 UTC 时间戳。JSON 数据必须带显式 `schema_version`，Pydantic 在读取时校验版本；不支持的版本返回 `CONFIG_VERSION_UNSUPPORTED`，不得静默按新结构解释。

### 6.1 用户与项目

`users`

- `id`、`username`（大小写规范化后唯一）、`password_hash`；
- `locale`、`is_active`、`created_at`、`updated_at`。

`user_sessions`

- `id`、`user_id`、`token_hash`（唯一）、`csrf_token_hash`；
- `created_at`、`last_seen_at`、`expires_at`、`revoked_at`。

`projects`

- `id`、`owner_user_id`、`name`、`research_goal`、`principal_name`；
- `created_at`、`updated_at`、`archived_at`。

### 6.2 问卷与配置版本

`questionnaires`

- `id`、`project_id`、`mode`（`survey` 或 `interview`）；
- `title`、`description`、`draft_config`、`draft_schema_version`；
- `draft_revision`（乐观并发控制）、`created_at`、`updated_at`、`archived_at`。

`questionnaire_versions`

- `id`、`questionnaire_id`、`version_number`、`schema_version`；
- `questions_json`、`content_hash`、`created_by_user_id`、`created_at`；
- 同一问卷的 `version_number` 唯一，记录创建后不可更新或删除。

`config_versions`

- `id`、`project_id`、`questionnaire_version_id`、`version_number`；
- `schema_version`、`respondent_plan_json`、`inference_config_json`、`run_settings_json`；
- `full_snapshot_json`、`content_hash`、`created_by_user_id`、`created_at`；
- `full_snapshot_json` 是复现运行的权威输入，记录创建后不可更新或删除。

启动运行时，后端在一个事务内验证草稿、按内容哈希复用或创建问卷版本、创建完整配置版本，再创建研究轮次。运行后的草稿修改只影响未来版本。

### 6.3 研究轮次与结果

`research_rounds`

- `id`、`project_id`、`questionnaire_id`、`config_version_id`；
- `name`、`mode`、`locale`、`status`、`row_version`；
- `parent_round_id`、`retry_of_round_id`、`retry_kind`；
- 总数、完成数、终止数、失败数、未完成数等摘要；
- `active_respondent_id`、`pause_requested_at`、执行租约所有者与过期时间；
- `created_at`、`started_at`、`finished_at`、`updated_at`、`error_code`、`error_message`。

`round_respondents`

- `id`、`round_id`、`source_respondent_id`、`ordinal`；
- `profile_json`、`status`、`completed_questions`、`total_questions`；
- `termination_code`、`termination_reason`、`error_code`、`error_message`；
- `started_at`、`finished_at`。

`sessions`

- `id`、`round_respondent_id`、`status`、起止时间和终止/失败字段。

`messages`

- `id`、`session_id`、`ordinal`、`role`、`question_id`；
- `content`、`sentiment`、`answer_value_json`、`created_at`。

`responses`

- `id`、`round_respondent_id`、`question_id`、`answer_value_json`；
- `status`、`created_at`；
- 同一轮次受访者与问题组合唯一。

`inference_results`

- `id`、`round_respondent_id`、任务标识、类型、状态；
- `value_json`、`reason`、`evidence_json`、错误字段和时间。

`export_records`

- `id`、`round_id`、`requested_by_user_id`；
- `format`、`scope`、`filters_json`、`filename`、`status`；
- `created_at`、`finished_at`、`error_code`、`error_message`。

聚合分析不单独保存为不可校验的事实表；它从轮次结果计算，并可在 API 响应中带口径元数据。若后续性能需要缓存，必须把轮次 `row_version` 纳入缓存键。

## 7. 运行状态机与恢复

### 7.1 轮次状态

合法主路径：

```text
queued → running → completed
                 ↘ completed_with_errors
running → pausing → paused → running
queued/running/pausing/paused → cancelled
queued/running/pausing → failed（基础设施级失败）
```

非法状态转换返回 `409 INVALID_RUN_TRANSITION`，响应包含当前状态和允许操作。

### 7.2 检查点

一次“问题消息 + 回答消息 + response + 受访者进度 + 轮次摘要”作为数据库事务提交。暂停请求不会中断正在提交的原子回答；提交完成后状态从 `pausing` 进入 `paused`。因此前端不会看到半条回答。

取消保留全部已提交结果，把活动和未开始的轮次受访者标记为未完成/已取消，并终止执行租约。取消不删除问卷版本、配置版本或部分结果。

### 7.3 单样本失败与重试

单个受访者执行异常只把对应 session 标记为 `failed`，其余样本继续。存在失败样本且其他样本已结束时，轮次为 `completed_with_errors`。

“仅重试失败样本”创建新轮次，引用原配置版本并复制失败受访者的原始画像；“重试未完成样本”适用于取消轮次，复制原轮次中未完成的受访者。新轮次通过 `retry_of_round_id` 追溯来源，原轮次不被覆盖。

### 7.4 后端重启恢复

执行器领取轮次前在 PostgreSQL 事务内获取带过期时间的执行租约和递增 `row_version`，避免同一轮次被重复执行。后端启动时将失去有效租约的 `queued/running/pausing` 轮次转为 `paused`，写入 `RUN_INTERRUPTED_BY_RESTART`，由用户显式点击继续。处于 `paused`、`completed*`、`cancelled` 或 `failed` 的轮次不自动执行。

## 8. API 边界

所有业务 API（健康检查、登录除外）要求应用会话。状态变更 API 要求 CSRF 校验。

### 8.1 身份

- `POST /api/auth/login`：用户名密码登录；
- `POST /api/auth/logout`：撤销当前会话；
- `GET /api/auth/me`：当前用户和语言；
- 不提供注册 API。

### 8.2 项目与问卷

- `GET/POST /api/projects`；
- `GET/PATCH /api/projects/{project_id}`；
- `GET/POST /api/projects/{project_id}/questionnaires`；
- `GET/PATCH /api/questionnaires/{questionnaire_id}`：读取或保存草稿，使用 `draft_revision` 防止旧请求覆盖新内容；
- `GET /api/questionnaires/{questionnaire_id}/versions`。

### 8.3 轮次与控制

- `POST /api/questionnaires/{questionnaire_id}/rounds`：固化版本并创建轮次；
- `GET /api/projects/{project_id}/rounds`：当前用户项目的轮次列表；
- `GET /api/rounds/{round_id}`：完整轮次快照；
- `POST /api/rounds/{round_id}/pause`；
- `POST /api/rounds/{round_id}/resume`；
- `POST /api/rounds/{round_id}/cancel`；
- `POST /api/rounds/{round_id}/retry`，请求体 `kind=failed|incomplete`；
- `POST /api/rounds/{round_id}/copy`：从历史配置创建新问卷草稿，不自动运行。

原 `/api/runs` 和 `/api/history` 契约在前端迁移完成后移除；不长期维护两套写入模型。必要的旧数据仅存在内存，当前没有可迁移的持久化用户数据。

### 8.4 分析与导出

- `POST /api/rounds/{round_id}/analytics/query`；
- `GET /api/rounds/{round_id}/exceptions`：终止/失败汇总和受访者明细；
- `POST /api/rounds/{round_id}/exports`：生成并记录导出；
- `GET /api/rounds/{round_id}/exports`：列出导出记录。

API 错误统一为 `{code, message, details}`。前端根据 `code` 显示本地化文案，后端 message 作为诊断回退。

## 9. 前端工作流

### 9.1 登录与资源选择

现有登录页改为应用用户登录。登录后加载 `/auth/me`；未登录或会话过期时返回登录页。页面头部提供当前用户名和退出按钮。

工作台头部增加项目与问卷选择器：

- 无项目时显示创建项目引导；
- 创建项目填写名称、研究目标和负责人；
- 项目内可创建问卷或访谈；
- 切换资源时取消过期请求，避免旧响应污染新用户当前视图；
- 页面不缓存其他用户的业务数据到持久浏览器存储。

### 9.2 配置与版本

配置面板编辑问卷草稿，采用防抖自动保存，显示“保存中 / 已保存于时间 / 保存失败并重试”。运行按钮仅在最新草稿已保存且校验通过时可用。

运行创建成功后，界面显示轮次名称、问卷版本、配置版本和“已自动保存”。查看历史时配置只读；“复制为新轮次”创建独立草稿后允许修改。

### 9.3 运行控制

结果区提供与当前状态匹配的操作：

- `running`：暂停、取消；
- `pausing`：显示等待当前回答完成，可取消；
- `paused`：继续、取消；
- `completed_with_errors`：仅重试失败样本；
- `cancelled`：重试未完成样本；
- 终态始终允许查看和导出已有结果。

每个操作显示进行中、成功和失败反馈，防止重复提交。前端轮询覆盖 `queued/running/pausing`；paused 和终态停止高频轮询，用户操作后立即刷新。

## 10. 分析口径与异常解释

每个分析响应包含统一 `scope`：

- `population_count`：轮次总样本数；
- `filtered_respondent_count`：当前筛选命中的受访者数；
- `valid_response_count`：当前问题拥有可分析回答的受访者数；
- `excluded_response_count`：筛选命中但无有效回答的数量；
- `filters`、`group_by` 和可读口径标签。

无筛选标记为“总体”；有筛选展示条件摘要。每个 group by 结果显示组内人数和有效回答数，禁止用回答条数冒充人数。`valid_response_count < 30` 时显示“小样本，仅作探索”提示，但不阻断结果。

概览区区分问卷和访谈语义：问卷使用作答、问卷完成率；访谈使用对话、访谈完成率。

异常区按 session 状态、稳定 `termination_code/error_code` 和本地化原因汇总。点击汇总项显示受访者、完成题数、总题数、最后一条有效回答及时间，并允许跳转到该受访者详情。

## 11. 导出契约

导出对话框要求：

- 格式：`json` 或 `csv`；
- 范围：`full`（完整轮次）、`filtered`（当前筛选范围）、`exceptions`（终止与失败样本）；
- 文件名：去除路径分隔符和控制字符，后端补正确扩展名；
- `filtered` 请求必须显式发送筛选条件，后端重新执行所有权和筛选校验，不能依赖前端已显示的数据。

后端先创建 `processing` 导出记录，成功后更新为 `succeeded`，异常时更新为 `failed` 并保存错误码。响应通过 `Content-Disposition` 返回最终文件名，并通过响应头返回导出记录 ID。界面展示文件名、范围、生成时间和状态；空范围返回 `422 EXPORT_SCOPE_EMPTY`，失败可按相同参数重试。

JSON 导出包含轮次元数据、项目/问卷引用、配置版本、受访者、结果、异常、推断和口径。CSV 每行对应一个受访者，稳定展开基本字段、逐题答案、状态、终止/失败字段和推断列。

## 12. 错误处理

至少定义并测试：

- `AUTH_INVALID_CREDENTIALS`、`AUTH_SESSION_EXPIRED`、`CSRF_INVALID`；
- `RESOURCE_NOT_FOUND`、`DRAFT_CONFLICT`；
- `INVALID_RUN_TRANSITION`、`RUN_INTERRUPTED_BY_RESTART`；
- `NO_RETRYABLE_RESPONDENTS`；
- `CONFIG_VERSION_UNSUPPORTED`；
- `EXPORT_SCOPE_EMPTY`、`EXPORT_GENERATION_FAILED`；
- `STORAGE_UNAVAILABLE`。

存储失败不得返回伪成功。事务失败回滚该检查点，轮次保留最后一个完整状态；前端显示可重试错误。日志包含错误码、资源 ID 和请求关联 ID，但不记录密码、会话令牌、CSRF 令牌或完整敏感回答。

## 13. 数据库迁移与实现边界

使用 SQLAlchemy 2.x 异步接口、asyncpg 和 Alembic：

- Alembic 是生产 schema 的唯一变更入口；
- 后端启动等待数据库健康后执行 `alembic upgrade head`；
- ORM 行模型与 API Pydantic 模型分离；
- `Repository` 协议暴露用户、项目、问卷、版本、轮次、结果和导出所需的最小方法；
- 纯业务单测使用内存仓储，PostgreSQL 集成测试使用真实数据库；
- 运行服务依赖仓储协议，不直接散落 SQL；
- 不把数据库连接、密码或内部主机名打包进浏览器代码。

迁移必须能在空数据库一次成功执行，并支持对当前 schema 的重复启动。由于当前版本没有持久数据库，不迁移 FastAPI 进程内历史。

## 14. Docker 与配置

新增：

- 根目录 `compose.yaml`；
- `frontend/Dockerfile` 或根目录前端 Dockerfile；
- `backend/Dockerfile`；
- `.dockerignore`；
- 数据库迁移和容器 entrypoint；
- Docker 部署测试脚本。

敏感配置通过 Git 忽略的部署环境文件和只读挂载的种子用户文件提供。仓库只提交 `.example` 文件。Compose 不把 PostgreSQL 端口发布到所有网卡；调试需要时只允许显式绑定 `127.0.0.1`。

健康检查层次：

1. PostgreSQL `pg_isready`；
2. FastAPI `/api/health` 同时报告数据库迁移就绪；
3. Next.js 同源 `/survey-api/health`；
4. 可选 Quick Tunnel 认证后的公网检查。

## 15. 验证闭环

### 15.1 测试驱动要求

每项新行为先写失败测试并确认因缺少该行为而失败，再写最小实现使其通过。配置文件和生成的迁移属于 TDD 例外，但必须通过契约或集成测试覆盖结果。

### 15.2 后端与数据库

- 用户登录、退出、会话过期、CSRF 和密码哈希；
- 两个用户之间项目、问卷、轮次、分析和导出互相返回 404；
- 草稿冲突、问卷版本和配置版本不可变；
- 合法/非法状态转换、暂停检查点、继续、取消、失败与未完成重试；
- 单样本失败不会终止其他样本；
- 总体、筛选、分组、有效和排除样本数；
- 终止/失败汇总与下钻；
- 三种导出范围、文件名净化和成功/失败记录；
- 空库迁移、约束、事务回滚和不支持版本；
- 后端重启将失租活动轮次恢复为 paused。

### 15.3 前端

- API 请求自动携带当前语言和 CSRF 头；
- 认证过期返回登录页；
- 项目/问卷选择不接受过期请求；
- 草稿自动保存状态；
- 运行控制按钮与状态严格匹配；
- 分析口径、小样本、异常下钻和模式文案；
- 导出范围、文件名及成功/失败反馈；
- `npm run test:frontend`、`npm run typecheck`、`npm run build` 全部通过。

### 15.4 Docker 与浏览器端到端

验证脚本和人工/浏览器流程必须覆盖：

1. 构建并启动三个核心服务；
2. 5 个预置用户均可登录；
3. 用户 A 创建项目、问卷和轮次，用户 B 的列表为空且直接访问 A 的 ID 得到 404；
4. 运行暂停、继续、取消和重试流程；
5. 重启 backend 后已保存轮次仍可打开，中断轮次为 paused；
6. 普通 `down/up` 后数据仍存在；
7. `pg_dump` 备份命令可生成非空备份，恢复步骤在隔离测试库验证；
8. 总体、筛选、分组、异常下钻和三种导出范围；
9. 390、768、1024、1280、1440 px 无页面级横纵溢出，移动、平板和桌面核心流程可用；
10. 浏览器控制台无 error/warning。

若本机网络无法建立真实 Quick Tunnel，必须记录原因，并至少通过 cloudflared 容器配置、脚本契约、本地认证和健康检查；不得把未执行的公网验证写成已通过。

## 16. 文档交付

实现完成后必须同步更新：

- 根目录 `README.md`：项目阶段、用户模型、持久化、架构、能力边界、Docker 快速开始和当前迭代重点；
- `docs/PROJECT_ITERATION.md`：日期、现状、P0 状态、实测基线、能力边界、本轮记录、验证、遗留问题和下一步；
- `deploy/README.md`、`RUNBOOK.md`、`ARCHITECTURE.md`、`SECURITY.md`、`TROUBLESHOOTING.md`：完整 Docker/macOS 操作、用户种子、备份恢复、卷生命周期、Quick Tunnel 和故障处理；
- `backend/README.md`：数据库、迁移、测试、种子用户和本地非 Docker 开发。

文档只记录实际验证通过的事实。旧的“内存历史”“共享账号代表应用用户”“后端重启丢失全部数据”等描述必须删除或明确标为历史状态。

## 17. P0 完成定义

只有以下条件全部满足，才把 P0 标记为完成：

1. 5 个预置账号可登录，用户 A 无法列出或直接访问用户 B 的任何研究资源；
2. 用户可以创建项目和问卷，草稿可持久保存；
3. 每次运行绑定不可变问卷版本和完整配置版本；
4. FastAPI 重启、容器重建和普通 Compose down/up 后已有轮次仍可打开；
5. 运行可暂停、继续、取消，并可在新轮次中重试失败或未完成样本；
6. 历史轮次可复制为新草稿，原配置和结果不改变；
7. 所有主要分析显示总体、当前筛选、有效样本和排除样本口径；
8. 终止与失败可汇总并下钻到受访者证据；
9. 保存和导出有进行中、成功、失败反馈，导出可选择范围和文件名并留下记录；
10. 三服务 Docker 部署、数据库 volume、备份恢复和可选公网入口有可执行文档；
11. 后端、前端、数据库、Docker、构建和五视口浏览器验证闭环通过；
12. README、PROJECT_ITERATION 和部署文档与真实实现一致。
