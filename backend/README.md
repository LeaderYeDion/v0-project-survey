# Survey Backend

FastAPI 后端负责应用用户认证、所有权校验、项目/问卷/不可变版本、研究轮次、分析、异常下钻、导出和 Mock 执行。生产路径使用 PostgreSQL；`MemoryRepository` 仅保留为协议一致的纯业务测试替身或无数据库组合，不是当前部署的数据源。

## 生产启动路径

Compose 中 backend 等待健康的 PostgreSQL，然后入口脚本依次执行：

1. root bootstrap 把只读种子 secret 复制为 `survey` 用户拥有的 `/app/runtime/seed-users.json` mode-600 容器内副本；入口脚本不删除该副本，它随容器可写层在容器替换/删除时消失；
2. 永久降权到 UID 10001；
3. `alembic upgrade head`；
4. `python -m app.cli seed-users --file ...`；
5. `uvicorn app.main:app --host 0.0.0.0 --port 8000`。

数据库 schema 的唯一生产变更入口是 Alembic。当前迁移 head 为 `20260912_0002`；初始 `20260905_0001` 创建 13 张 P0 表，0002 删除三个旧重复索引并增加 `ix_export_records_status_created(status, created_at)`，兼容已应用旧初始迁移的数据库。`/api/health` 要求数据库可达且恰为 0002；停留在 0001 会返回 503。

入口支持 `--prepare-only`：完成同样的私密 secret 引导、降权、迁移和五用户幂等同步后退出，不启动 Uvicorn。生产恢复在应用停止期间通过 `compose run --rm --no-deps -T backend --prepare-only` 执行它；只有准备成功才重启服务。任一迁移/种子失败都会阻止启动。

入口也支持 `--preflight-only`：私密 secret 引导/降权后，使用现有 Pydantic `SeedUsers` 验证五个固定用户名、密码长度和 `zh-CN`，仅输出恢复契约标记；不导入数据库配置、不迁移、不 seed、不启动服务。恢复在停应用前，用已检查的镜像 ID 创建 network-none、只读根文件系统、临时 runtime 的容器执行该预检。缺失/旧镜像或无效 seed 会在任何服务停止/启动/导入前失败；宿主文件仍须 mode 600，预检错误不回显密码。

推荐从仓库根目录使用：

```bash
npm run docker:init
npm run docker:up
npm run docker:status
```

## 本地非 Docker 开发

初始化隔离的 Python 3.14.6 环境：

```bash
bash backend/scripts/bootstrap.sh
```

完整应用需要真实 PostgreSQL async URL：

```bash
export DATABASE_URL='postgresql+asyncpg://survey:<password>@127.0.0.1:5432/survey'
npm run dev:backend
```

前端默认通过 `http://127.0.0.1:8000` 的同源 rewrite 访问后端，可用 `SURVEY_BACKEND_URL` 覆盖。没有 `DATABASE_URL` 时，应用用户登录返回不可用；该模式只适合部分纯业务/Mock 测试，不提供持久化产品流程。

默认地址：

- FastAPI：`http://127.0.0.1:8000`
- OpenAPI：`http://127.0.0.1:8000/docs`
- 健康：`http://127.0.0.1:8000/api/health`

## 预置用户与密码

`npm run docker:init` 生成严格的 `researcher01`–`researcher05` 五账号 JSON。数据库只保存 Argon2id 密码哈希；幂等同步只创建缺少的用户，不会在容器重启时覆盖现有密码。

CLI 必须从 `backend/` 或设置好 Python import 路径后运行：

```bash
cd backend
.venv/bin/python -m app.cli seed-users --file ../deploy/config/seed-users.json
.venv/bin/python -m app.cli reset-password --username researcher01 --password '<new-password>'
```

不要把明文密码写入 Git、Issue、日志或共享终端历史。部署 seed 文件必须保持 mode 600；修改 seed 文件不会重置数据库中已经存在的用户，密码轮换必须使用 `reset-password`。

## 身份与所有权边界

- `survey_session` 保存原始随机会话令牌，仅 HttpOnly Cookie 可见；数据库只保存 SHA-256 哈希。
- `survey_csrf` 与 `X-CSRF-Token` 执行双提交校验；状态变更还检查 Origin/转发 Host。
- 所有研究资源从服务端 `CurrentUser` 解析 owner，不接受客户端任意 `user_id`。
- 跨用户和不存在的资源均返回 `404 RESOURCE_NOT_FOUND`，避免泄露资源存在性。
- 可选的部署外围 Basic Auth 不能构造应用用户，也不能绕过 owner 校验。

## 数据与运行语义

- 问卷草稿使用 `draft_revision` 乐观并发。
- 启动轮次时在事务内创建或复用内容哈希一致的不可变问卷/配置版本。
- 回答、响应、消息、推断、进度和租约 heartbeat 按完整检查点提交。
- 优雅停止会把本执行器持有的活动轮次转为 paused；失租的 queued/running/pausing 在启动对账时变为 paused，并记录 `RUN_INTERRUPTED_BY_RESTART`。
- 存储故障规范化为 `STORAGE_UNAVAILABLE`，检查点失败回滚；执行器失败释放本地任务，过期租约可定期恢复，关闭会等待活动任务。
- JSON 导出包含完整冻结配置、轮次进度/时间/来源、口径、session 异常与推断；CSV 按冻结题目和任务 ID 稳定展开，缺失推断保留空列。同名任务和特殊 task ID 不会覆盖列。
- 导出记录超过处理时限会收敛为失败；终态不会被旧任务覆盖。0002 的索引支持该扫描。
- 2026-09-19 PostgreSQL volume 跨 backend restart、普通 down/up（容器重建）及备份两次隔离恢复已通过真实 smoke。

## 测试与检查

```bash
backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/python -m pip check
backend/.venv/bin/python -m compileall -q backend/app backend/tests
```

2026-09-18 在 `b6e08cd` 完整 suite 为 173/173 通过（4.79 s），包含 6 个无数据库 seed 预检回归，以及存储错误、租约、关闭、导出稳定元数据与 0002 迁移的回归。PostgreSQL SQL 编译和 SQLite 迁移执行不能替代 live PostgreSQL；该记录是历史基线。2026-09-19 修复镜像模板缺失后 suite 为 174/174；真实镜像预检、upgrade、mounted seed、持久化与两次恢复已通过。downgrade 和完整故障矩阵不在本轮通过声明中。

## Mock 边界

Mock 专属模板、画像、回答、终止和标签位于 `app/mocks/`，通用服务依赖 `TemplateProvider`、`AnalysisLabels` 与 `SimulationEngine` 协议。替换为真实模型时应在组合根更换实现，并保留 API、所有权、版本、检查点和导出契约。

当前 Mock 结果只适合演示、探索、预实验和假设生成，不是现实样本或正式研究结论。

## 2026-09-19 LLM 接入准备度

模板运行资源已自包含于 `app/mocks/data/`，不依赖仓库外的 `task_examples/`。真实 API/DB 底座可保留，但模型接口目前同步、无独立续租、无调用记录/模型提示词版本。已复现非法选项答案入库、推断失败仍标记轮次完成，以及缩短租约下长调用误暂停。接入真实 provider 前需整改，详见[现场检查报告](../docs/verification/2026-09-19-live-deployment-and-llm-readiness.md)。
