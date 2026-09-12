# Survey Backend

FastAPI 后端负责应用用户认证、所有权校验、项目/问卷/不可变版本、研究轮次、分析、异常下钻、导出和 Mock 执行。生产路径使用 PostgreSQL；`MemoryRepository` 仅保留为协议一致的纯业务测试替身或无数据库组合，不是当前部署的数据源。

## 生产启动路径

Compose 中 backend 等待健康的 PostgreSQL，然后入口脚本依次执行：

1. root bootstrap 把只读种子 secret 复制为 `survey` 用户拥有的 mode-600 临时文件；
2. 永久降权到 UID 10001；
3. `alembic upgrade head`；
4. `python -m app.cli seed-users --file ...`；
5. `uvicorn app.main:app --host 0.0.0.0 --port 8000`。

数据库 schema 的唯一生产变更入口是 Alembic。当前迁移 head 为 `20260905_0001`，包含 13 张 P0 表。`/api/health` 在配置数据库后同时检查数据库可达性和迁移 head；不可用返回 503，不返回伪健康。

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
- PostgreSQL volume 的实际跨重启/down-up 行为仍需在 daemon 可用环境执行验证记录中的 live smoke；静态实现不能替代该证据。

## 测试与检查

```bash
backend/.venv/bin/python -m pytest backend/tests -q
backend/.venv/bin/python -m pip check
backend/.venv/bin/python -m compileall -q backend/app backend/tests
```

2026-09-09 完整 suite 为 127/127 通过。数据库 ORM、PostgreSQL SQL 编译、迁移结构和业务协议有自动化覆盖，但当前工作站 Docker daemon 不可用，所以本轮没有执行 live PostgreSQL upgrade/downgrade、事务/租约或 mounted seed 验证。

## Mock 边界

Mock 专属模板、画像、回答、终止和标签位于 `app/mocks/`，通用服务依赖 `TemplateProvider`、`AnalysisLabels` 与 `SimulationEngine` 协议。替换为真实模型时应在组合根更换实现，并保留 API、所有权、版本、检查点和导出契约。

当前 Mock 结果只适合演示、探索、预实验和假设生成，不是现实样本或正式研究结论。
