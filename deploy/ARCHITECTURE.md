# Docker 部署架构与信任边界

## 服务拓扑

```text
本地浏览器                         可选公网浏览器
    │ HTTP                               │ HTTPS
    │                                   ▼
    │                         Cloudflare Quick Tunnel
    │                                   │
    └──────────────┬────────────────────┘
                   ▼
       frontend / Next.js :3000
       host: 127.0.0.1:${LOCAL_PORT}
          │ /survey-api/* rewrite
          ▼
       backend / FastAPI :8000
          │ PostgreSQL async transactions
          ▼
       db / PostgreSQL 17 :5432
          │
          ▼
       survey_postgres_data volume
```

核心服务是 `frontend`、`backend`、`db`。`cloudflared` 只在 `public` profile 中启动，不计入三个核心服务。

## 网络边界

- frontend 同时连接 `edge` 和 `app_internal`；
- backend 与 db 只连接 `internal: true` 的 `app_internal`；
- cloudflared 只连接 `edge`，目标是 `http://frontend:3000`；
- 宿主机只发布 frontend，且明确绑定 `127.0.0.1`；
- backend 和 PostgreSQL 没有宿主端口映射；
- 生产 Compose 不挂载源代码目录。

因此，本地和公网客户端都必须先经过 Next.js；浏览器不能直连 backend 或 db。Quick Tunnel 是仅出站连接，不要求端口转发，但未授权请求仍会到达 frontend 的外围边界。

## 两层身份的区别

### 应用用户（权威业务身份）

`researcher01`–`researcher05` 通过 `/survey-api/auth/login` 登录。FastAPI 创建数据库-backed 会话，后续从 `survey_session` 解析 `CurrentUser`。所有项目、问卷、版本、轮次、分析、异常和导出都由这个用户 ID 限定。

### 可选外围门禁

`DEPLOY_AUTH_ENABLED=true` 时，Next.js proxy 可额外要求共享外围凭据。它默认关闭，仅作为公网演示的附加门。外围 Cookie/Basic Authorization 不会变成 `CurrentUser`，不能读取任何用户的研究资源；通过外围门后仍必须使用一个应用用户登录。

`/login` 根据服务端验证后的外围 Cookie 分为部署访问和研究账号两步，切换步骤清空凭据；外围会话过期使用 `DEPLOY_AUTH_REQUIRED` 返回登录边界。默认关闭时只有研究账号步骤。

## 启动依赖与健康

```text
db healthy
  └─> backend bootstrap
        ├─> private seed copy + drop privilege
        ├─> alembic upgrade head
        ├─> idempotent seed-users
        └─> backend health: DB reachable + exact migration head
              └─> frontend start + same-origin health
                    └─> optional cloudflared start
```

Compose `depends_on` 使用 health 条件。backend `/api/health` 在数据库不可达时报告 `unavailable`，迁移不是期望 head 时报告 `migration_pending`，并返回非健康状态。frontend 健康从同一容器请求 `/survey-api/health`，兼容外围门禁开启/关闭两种模式。

## 数据与版本

PostgreSQL 包含用户、会话、项目、问卷、不可变问卷版本、不可变完整配置版本、研究轮次、受访者、session、message、response、推断和导出记录。Alembic 是 schema 的唯一生产变更入口。

当前 head 是 `20260912_0002`，从 0001 删除冗余索引并增加导出状态/创建时间索引。导出保存完整冻结配置、稳定轮次元数据和筛选口径；CSV 的题目与推断列由冻结配置顺序确定。旧处理记录超时后转为失败，终态保护避免迟到任务覆盖。

每次运行先从 owner-scoped 问卷草稿固化版本，然后创建轮次。历史轮次通过版本 ID 指向原始完整配置；修改当前草稿或复制历史不会更新原版本。分析和导出从持久化 normalized rows 重建，不以浏览器或进程内对象作为权威数据。

## 执行与恢复

FastAPI 内置执行器使用 row-version compare-and-swap、数据库租约和回答级事务检查点：

- 一次答案的消息、response、进度、推断和租约 heartbeat 原子提交；
- 暂停在完整检查点后生效，不暴露半条答案；
- 取消保留已提交结果；
- retry 创建引用原配置版本的新轮次，不改写来源；
- 优雅关闭立即把本执行器持有的活动轮次变为 paused；
- 异常终止后，下一次启动把失租的 queued/running/pausing 轮次对账为 paused，并记录 `RUN_INTERRUPTED_BY_RESTART`。

本轮没有 Redis、Celery 或独立 Worker；这些语义适用于 P0 的单 backend 服务，而不是多 worker 调度 SLA。

执行器清理失败任务，周期恢复失租轮次，关闭时等待活动任务；存储失败回滚并映射为 `STORAGE_UNAVAILABLE`。前端资源 effect 使用取消、generation 和当前用户/语言/资源身份校验，过时成功/失败均不能覆盖新选择；历史状态由显示的轮次决定。

生产数据库恢复在共享维护锁内先用已构建镜像的 immutable ID 执行 network-none `--preflight-only`，验证镜像契约和 Pydantic 五用户 seed，不连接数据库；随后只读验证归档/目标。全部通过才停止外围入口和应用，保持 db，并在导入前确认应用无 running/restarting/paused 服务。事务导入后一次性 backend `--prepare-only` 迁移/seed，再启动应用并检查健康。停止后的失败保持应用停止并保留卷；成功后公网也需显式启用。该流程的实际容器/数据库验收仍待执行。

同一 OS 用户/Compose project 的 restore 与受支持 start/up 脚本共享 `/tmp/survey-maintenance-<UID>/<project>.lock`。原子 mkdir 提供互斥；token 防止错误释放他人锁；遗留/不完整锁不自动抢占，须核对进程与 Docker 工作后人工隔离。直接 Docker/DB 命令或其他 OS 用户不受此锁约束。

## Volume 生命周期

`db` 把 `/var/lib/postgresql/data` 挂载到 named volume `survey_postgres_data`。实际 Docker 名称通常带 `COMPOSE_PROJECT_NAME` 前缀并有 Compose labels。

| 操作 | 容器 | 数据库 volume |
| --- | --- | --- |
| `docker compose restart` | 重启 | 保留 |
| 重新 build/up | 可能替换 | 保留 |
| `npm run docker:down` | 删除容器/网络 | 保留 |
| 启动失败回滚 | 删除本轮容器/网络 | 保留 |
| `down --volumes` | 删除容器/网络 | 删除（破坏性） |

普通 down/up 后保持同一 volume；容器 ID 变化不等于数据删除。只有明确的 `--volumes` 操作会删除当前 Compose 项目的数据库 volume。

## 备份与恢复边界

备份在 db 容器内用 `pg_dump --format=custom --no-owner --no-privileges` 生成，最终文件位于 Git 忽略的 `deploy/backups/` 且权限为 600。恢复要求显式 `--confirm`，仅针对当前私密配置指定的 Compose project/database，停止应用后使用 `pg_restore --single-transaction --clean --if-exists --exit-on-error`。

持久化 smoke 的隔离恢复使用随机 Compose project/database，并只对该隔离项目执行 `down --volumes`。主部署的普通停止、失败回滚和日常升级都不删除 volume。

## 已验证与待验证

2026-09-18 的 70 项部署契约验证服务拆分、网络、健康依赖、secret、非 root runtime、volume、恢复顺序/失败清理、镜像/seed 预检、维护锁争用和 public profile。恢复整改独立静态复审为 Critical/Important/Minor 0/0/0，静态交接获批；本轮 Docker 探测因本地 socket 不存在失败，尚未实际构建镜像、启动容器或验证 PostgreSQL/volume；架构设计和 live 运行证据必须区分。
