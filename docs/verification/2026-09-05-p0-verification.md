# P0 验证记录：可信、可控、可复现调研平台

> 设计基线：2026-09-05
>
> 最近复验：2026-09-18（历史执行：2026-09-09/11/12；前端浏览器整改：2026-09-13）
>
> 分支：`real-backend-v1`
>
> 当前恢复实现：`b6e08cd`；第一轮恢复实现：`963de15`；第一轮文档：`d81fe61`。`6c16ec9` 为恢复整改前基础，历史 Task 10 基线为 `99522df`。
>
> 结论：**后端、前端与恢复整改均通过独立静态审查，静态实现交接获批。已执行自动化/静态检查通过；完整 P0/live Docker/PostgreSQL/五账号/五视口验收仍待补。**

## 0. 2026-09-18 最新整改验证（取代历史当前状态）

本节是当前事实。第 1–12 节保留早期执行证据和待补矩阵；其中旧测试计数、环境与“实现完成”推断不是当前审批结论。

| 检查 | 实测结果 | 边界 |
| --- | --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests -q` | PASS，173 passed in 5.27 s | 当前最终复验；含 6 项无数据库 seed 预检；非 live PostgreSQL |
| `npm run test:frontend` | PASS，138/138，795.960 ms | 当前最终复验；含外围登录、CSRF、取消/代际/历史状态 |
| `node --test deploy/tests/*.test.mjs` | PASS，70/70，文档落盘后复验 9.488 s | 当前最终复验；真实脚本/Pydantic，Docker/curl 等外部边界为替身 |
| `npm run typecheck` | PASS，exit 0 | 独立 TypeScript 校验 |
| `npm run build` | PASS，exit 0；compile 2.6 s；5/5 pages | 最终复验在批准的 helper-process 环境；仍有 Babel 警告与 Next 内置类型跳过提示 |
| 逐文件 `bash -n`（deploy scripts/tests 与 backend entrypoint） | PASS，exit 0 | 包含 live smoke 语法，不代表已执行 |
| 完整显式示例环境下 Compose public profile `config --quiet` | PASS，exit 0 | 无 daemon，使用 `.example` env/seed；不读取生产 secret |
| `docker info --format '{{.ServerVersion}}'` | FAIL，exit 1；约 0.06 s | `/Users/mymac/.docker/run/docker.sock` 不存在 |
| image build/up、live PostgreSQL/volume/restore、五账号/五视口/autosave/Quick Tunnel | NOT RUN / PENDING | 不以静态或 fixture 测试替代 |

第一轮历史恢复 TDD：新增 16 项生命周期/entrypoint 契约，首次 RED 为 13 failed、3 passed；实现后 16/16 GREEN。旧测试缺少新增 seed 要求曾为完整 59/60，更新 fixture 后 60/60；补精确恢复命令时另有 6 failed、10 passed 的 RED。以上对应 `963de15`，不代表当前计数。

第二轮 `b6e08cd`：无数据库/Pydantic 预检 RED 6 failed，GREEN 6 passed；restore 生命周期新增 7 个失败覆盖缺失/旧镜像、无效 seed、停止重查与 restore/restore、restore/start 重叠，最小实现后 22/22 GREEN；遗留锁、owner token、失败释放和 preflight-only entrypoint 的 4 个覆盖补充用例首次即通过，最终 focused 26/26。旧部署 fixture 缺少镜像响应曾为 19/20，更新边界 fixture 后完整部署 70/70。

当前恢复先获得同一 OS 用户/Compose project 的共享维护锁，校验私密文件/配置并对已构建 backend image ID 创建 network-none、只读根文件系统的临时容器。`--preflight-only` 仅执行现有 Pydantic SeedUsers 校验和版本化恢复契约标记，不导入 DB 配置、不迁移/seed；无效 seed 或缺失/旧镜像在任何 service stop/up、Compose run 或破坏性导入前被拒绝。随后只读验证归档/目标，停止应用，仅保留 db，导入前重查 running/restarting/paused 服务。事务导入后执行迁移/seed、启动及 health。停止后的失败再次停止应用并给出精确恢复命令；普通 volume 保留，成功后公网仍需显式启用。

锁位于 `/tmp/survey-maintenance-<UID>/<project>.lock`，原子 mkdir 争用失败，元数据私密，退出只释放自己的 token。restore 全生命周期和支持的 start/up/build/health 流程持锁；遗留锁不自动抢占，确认进程/Docker 工作结束后人工移动隔离。直接 Docker/DB 命令、独立 `docker:build`、其他 OS 用户可绕过锁；维护窗口仍需协调。完整操作见 [RUNBOOK 第 8 节](../../deploy/RUNBOOK.md#8-恢复)。

最终收束重新执行后端 173、前端 138、部署 70、类型检查、生产构建、shell、Compose、文档状态与 diff 检查。真实镜像内预检和维护锁配合 live 恢复均未执行，不把命令替身结果写成 Docker 通过。

文档收束复验：部署 70/70；逐文件 shell 与示例环境 Compose config exit 0；当前状态文档陈旧审批措辞扫描无命中；旧计数和旧完成断言只在明确历史记录中保留；`git diff --check` 通过。

Live hook `deploy/tests/persistence-smoke.sh` 现会启动运行中的随机隔离应用（默认空闲端口 3001，可用 `RESTORE_SMOKE_PORT` 调整），连续两次调用生产恢复，再检查 0002、精确五用户名、重新登录、原轮次 ID 和项目数量。它只删除自己创建的隔离 volume；主项目 smoke 数据/备份保留。该 hook 本轮仅语法/连接契约验证，尚未执行。

后端最新 head 为 `20260912_0002`：兼容旧 0001，删除三个冗余索引并增加过期导出扫描索引。readiness 要求新 head。存储错误规范化、导出终态/超时收敛、租约恢复/关闭等待、完整 JSON 元数据、冻结配置顺序的 CSV task ID 列已通过回归和静态审查；live PostgreSQL 语义仍待验收。

前端截至 `6c16ec9` 的静态审查已通过。2026-09-13 独立浏览器 suite 4/4 覆盖两步登录/凭据清空/安全 redirect 和迟到项目响应，使用真实 Next/Chrome 与 HTTP backend fixture；不是 Docker/PostgreSQL/五视口证据。当前 138 测试涵盖 CSRF_INVALID、本地化和请求取消/身份代际守卫、历史状态隔离。

恢复整改第二轮独立静态复审结论为 Critical/Important/Minor 0/0/0：已构建镜像 immutable ID 下的无网络/只读预检、严格五用户 Pydantic seed 校验、共享维护锁、导入前服务状态重查及重叠操作回归均获批准。静态实现交接获批；完整 P0 仍为现场验收 pending。

## 1. 历史 Task 10 结论边界

Task 1–9 已实现 PostgreSQL schema、五用户认证、owner-scoped 研究资源、不可变版本、可恢复轮次、明确分析、异常下钻、范围导出、前端工作流和三服务 Compose 部署。Task 10 从干净 Git 状态重新运行 daemon 不可用时仍能完成的非 Docker 自动化/静态子矩阵，并更新存活文档。

本机 Docker CLI/Compose 存在，但 daemon 未在有界检查内返回可用 Server 信息。由于 Docker frontend 没有启动，本轮无法使用 Playwright 执行当前完整业务流。以下两类证据必须严格分开：

- **PASS**：在本轮实际执行并退出 0 的测试、类型、构建、shell、Compose 静态模型；
- **PENDING**：没有可用 daemon/运行服务，因此没有执行的 image build、live PostgreSQL、持久化、五账号、五视口和 Quick Tunnel。

静态契约证明配置/脚本表达了预期边界，但不能证明镜像可构建、容器可启动、数据库可迁移或数据可恢复。

## 2. 环境与前置检查

```text
node: v24.17.0
npm: 11.17.0
python: 3.14.6
docker client: 29.5.3, build d1c06ef
docker compose: v5.1.4
branch: real-backend-v1
baseline commit: 99522df
```

初始 `git status --short` 无输出，文档前工作区干净。

Playwright 必要前置：

```bash
command -v npx >/dev/null 2>&1
command -v npx
```

结果：exit 0，路径为 `/Users/mymac/.local/state/fnm_multishells/39179_1788664171453/bin/npx`。这只证明 CLI wrapper 的依赖存在，不代表浏览器流程已执行。

## 3. 本轮新鲜非 Docker 自动化/静态子矩阵

下表只覆盖本轮实际执行的子矩阵。Task 10 要求的 `docker compose build` 因 daemon readiness gate 未通过而 **NOT RUN**；因此不得把本节称为完整非浏览器矩阵或完整 P0 验证。

| 检查 | 结果 | 计数/耗时 | 备注 |
| --- | --- | --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests -q` | PASS | 127 passed；pytest 2.92 s；wall 3.13 s | 内存 test double、API、schema、迁移/SQL 结构等自动化；非 live PostgreSQL |
| `npm run test:frontend` | PASS | 114 passed；Node 312.665 ms；wall 0.49 s | action/race/API/UI 源契约等；非真实浏览器 |
| `npm run typecheck` | PASS | exit 0；wall 0.71 s | `tsc --noEmit` |
| `npm run build` | PASS（批准的外部重跑） | compile 2.5 s；5/5 static pages；wall 3.86 s | 见构建环境与警告 |
| `node --test deploy/tests/*.test.mjs` | PASS | 44 passed；Node 5.400 s；wall 5.50 s | 2026-09-12 review-fix 复验；Compose/Dockerfile/脚本契约和 stubbed 脚本行为 |
| `bash -n deploy/scripts/*.sh backend/docker-entrypoint.sh` | PASS | exit 0；wall 0.00 s | shell 语法 |
| `docker compose config --quiet` | PASS with warnings | exit 0；wall 0.24 s | 未自动读取私密 `deploy.env`，对三个未设置 DB 变量各发出重复默认空值警告 |
| 完整显式环境 + example seed 的 `docker compose --profile public ... config --quiet` | PASS | exit 0；wall 0.25 s | 无输出；只解析 Compose，不访问 daemon |
| `docker compose build` / `npm run docker:build` | **NOT RUN** | 无耗时/退出码 | Docker daemon 未被证明 ready；不属于上述通过子矩阵 |

完整后端输出摘要：

```text
........................................................................ [ 56%]
.......................................................                  [100%]
127 passed in 2.92s
```

完整前端/部署摘要：

```text
frontend: tests 114, pass 114, fail 0, duration_ms 312.664583
deploy:   tests 44,  pass 44,  fail 0, duration_ms 5399.822834
```

Compose 的无 secret 静态渲染命令为：

```bash
COMPOSE_PROJECT_NAME=survey-task10 \
LOCAL_PORT=3000 \
POSTGRES_DB=survey \
POSTGRES_USER=survey \
POSTGRES_PASSWORD=task10-local-postgres-password-2026 \
SIMULATION_TERMINATION_ENABLED=false \
DEPLOY_AUTH_ENABLED=false \
DEPLOY_USERNAME= \
DEPLOY_PASSWORD= \
DEPLOY_SEED_USERS_FILE=./deploy/config/seed-users.example.json \
docker compose --profile public \
  --env-file deploy/config/deploy.env \
  config --quiet
```

该命令仅使用非生产验证值，不修改私密文件。

## 4. 构建环境与非失败警告

普通 managed sandbox 中的第一次 `npm run build` 停在 `Creating an optimized production build ...`，117.83 s 无进一步输出后被有界取消，exit 130。此前任务已经确认 Turbopack 需要创建 helper process/绑定内部端口；依照权限规则，原命令在批准的外部环境重跑并 exit 0。

成功构建仍有两个已知提示：

```text
Using external babel configuration from .babelrc
It looks like there is a custom Babel configuration that can be removed.
Skipping validation of types
```

这些提示没有导致构建失败。类型跳过由本轮独立且成功的 `npm run typecheck` 补验；Babel 配置清理不在 P0 范围。

## 5. Docker daemon 证据

第一次 sandbox 探测：

```bash
DOCKER_CLIENT_TIMEOUT=5 COMPOSE_HTTP_TIMEOUT=5 \
docker info --format '{{json .ServerVersion}}'
```

exit 1：

```text
permission denied while trying to connect to the docker API at
unix:///Users/mymac/.docker/run/docker.sock
```

按权限规则进行的外部同命令探测没有在有界等待内返回，随后明确中断，最终 exit 130 且无 ServerVersion。文档编辑前又进行一次最终有界 daemon retry，仍未返回并被终止。Task 9 的先前记录还观察到 Docker Desktop `Status starting` 与 Engine API `/info` HTTP 500。

结论：daemon 在本轮没有被证明 ready。后续不再无限等待，也没有启动 image build/up。

## 6. 未执行的 live 验收

以下状态均为 **PENDING / NOT RUN**，不是失败通过，也不是由自动化替代：

- `docker compose build` / `npm run docker:build`；
- `npm run docker:up` 的 db/backend/frontend 实际启动和 health；
- 空 PostgreSQL 的 live Alembic upgrade/downgrade；
- mounted seed secret、root bootstrap、UID 10001 降权和五用户真实同步；
- SQL auth/research/round/analytics/export repository 的 live transaction；
- `bash deploy/tests/persistence-smoke.sh`；
- backend restart、容器重建和普通 down/up 保留相同 ID；
- 活动轮次中断后 paused 与显式恢复；
- `pg_dump` 非空备份及随机隔离数据库 `pg_restore`；
- 五个账号逐一登录、`/auth/me`、owner-only list、显式 logout、后续业务 API `401 AUTH_SESSION_EXPIRED`；
- 390×844、768×720、1024×720、1280×720、1440×720 的当前完整业务浏览器流程；
- 当前流程中的 document width/height、页面级溢出和 console warning/error 计数；
- public profile 的真实 `trycloudflare.com` URL、登录、健康和 owned project 请求。

## 7. 五视口浏览器验收清单

daemon 和三个核心服务 ready 后，使用要求的 Playwright CLI wrapper：

```bash
command -v npx >/dev/null 2>&1
export PWCLI="${CODEX_HOME:-$HOME/.codex}/skills/playwright/scripts/playwright_cli.sh"
mkdir -p output/playwright/p0
cd output/playwright/p0
"$PWCLI" --session p0 open http://127.0.0.1:3000 --headed
"$PWCLI" --session p0 snapshot
```

每次交互先 snapshot，导航、modal 或重要 DOM 变化后重新 snapshot，再使用最新 element ref。依次执行：

```bash
"$PWCLI" --session p0 resize 390 844
"$PWCLI" --session p0 resize 768 720
"$PWCLI" --session p0 resize 1024 720
"$PWCLI" --session p0 resize 1280 720
"$PWCLI" --session p0 resize 1440 720
```

每个视口都必须记录：

```bash
"$PWCLI" --session p0 eval \
  "({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})"
"$PWCLI" --session p0 console error
"$PWCLI" --session p0 console warning
"$PWCLI" --session p0 screenshot
```

验收要求 `innerWidth/clientWidth` 与目标宽度一致、`innerHeight/clientHeight` 与目标高度一致、无页面级横纵溢出；分别执行 `console error` 和 `console warning`，两类计数都必须为 0。覆盖流程：

1. 应用用户登录和 `/auth/me` 身份；
2. 创建项目和问卷，编辑后等待自动保存；
3. 启动轮次，暂停到完整检查点、继续；
4. 另建轮次，取消并 retry incomplete；构造失败场景并 retry failed；
5. 打开历史、复制为新草稿，确认来源配置/结果不变；
6. 总体、筛选、多维 group analysis 和四个 scope count；
7. 异常汇总、下钻和受访者定位；
8. full/filtered/exceptions 三范围导出及记录；
9. 移动 Tabs、平板 Sheets、桌面三栏/拖拽；
10. 逐个账号显式 logout，确认随后业务请求为 `401 AUTH_SESSION_EXPIRED`。

五个账号需要分别完成 login → me → owner list → logout → post-logout 401；至少用第二账号直接请求第一账号的项目、问卷、版本、轮次、分析和导出 ID，并确认统一 404。

## 8. daemon 恢复后的执行顺序

如果存在旧 host-process `deploy.env`，先按 RUNBOOK 迁移；不要输出 secret 内容。然后：

```bash
docker desktop restart
docker desktop status
docker info
npm run docker:init
npm run docker:build
npm run docker:up
bash deploy/tests/persistence-smoke.sh
```

核心 smoke 通过后运行第 7 节浏览器清单。网络允许时再执行：

```bash
npm run docker:down
npm run docker:up -- --public
npm run docker:status
```

记录真实 public HTTPS URL 后验证登录页、应用用户登录、同源 health 和一个 owned project 请求。网络阻止 Tunnel 时保留 cloudflared 精确错误，并只报告 local/contract 结果。

收尾时普通停止，保留主数据库 volume：

```bash
npm run docker:down
```

## 9. P0 完成标准逐项状态

| # | 标准 | 当前状态 |
| --- | --- | --- |
| 1 | 五账号登录与跨用户隔离 | 实现/自动化 PASS；live 五账号 PENDING |
| 2 | 项目、问卷、草稿持久保存 | 实现/自动化 PASS；live PostgreSQL PENDING |
| 3 | 不可变问卷/完整配置版本 | 实现/自动化 PASS；live PostgreSQL PENDING |
| 4 | restart/recreate/down-up 后轮次仍可打开 | 脚本契约 PASS；live PENDING |
| 5 | 暂停、继续、取消、两种重试 | 实现/自动化 PASS；live browser PENDING |
| 6 | 历史复制且原数据不变 | 实现/自动化 PASS；live browser PENDING |
| 7 | 总体、筛选、有效、排除分析口径 | 实现/自动化 PASS；live browser PENDING |
| 8 | 异常汇总与证据下钻 | 实现/自动化 PASS；live browser PENDING |
| 9 | 保存/导出反馈、范围、文件名、记录 | 实现/自动化 PASS；live browser PENDING |
| 10 | 三服务、volume、备份恢复、公网文档 | 文档/契约 PASS；live Docker/Tunnel PENDING |
| 11 | backend/frontend/database/Docker/build/五视口闭环 | 非 live 矩阵 PASS；database/Docker/browser PENDING |
| 12 | 存活文档与真实实现一致 | PASS：当前/历史/待验收已明确分层，结构与链接检查通过 |

任何含 PENDING 的标准都阻止完整 P0 标记为完成。当前正确表述是：**P0 implementation complete; live acceptance pending**。

## 10. 已知非阻塞工程事项

- 自定义 Babel 配置仍产生警告，Next 构建跳过内置类型验证；独立 typecheck 通过。
- `npm run lint` 所指向的 ESLint 依赖/可执行文件仍未安装；本轮未把不可用 lint 写成通过，也未将其列入 Task 10 强制矩阵。
- `RoundExecutor._tasks` 对已完成 task 的进程期保留是既有 deferred minor，不影响本轮静态矩阵，但长期运行前应增加完成清理。
- live PostgreSQL 事务/竞态仍需真实数据库证据；当前自动化主要通过协议一致的 memory test double、SQL 编译和结构契约覆盖。

## 11. 文档更新后的关键复验

所有存活文档和本报告写入后，重新运行关键链：

| 检查 | 结果 | 新鲜证据 |
| --- | --- | --- |
| `npm run typecheck` | PASS | exit 0；wall 1.04 s |
| `npm run build` | PASS（批准的外部运行） | compile 2.6 s；5/5 static pages；wall 4.29 s；保留同一 Babel/内置类型跳过提示 |
| `backend/.venv/bin/python -m pytest backend/tests -q` | PASS | 127 passed in 3.31 s；wall 3.62 s |

文档不改变运行代码，但这些复验防止链接/文本编辑意外影响 TypeScript/构建输入或仓库状态。

最终 stale-claim scan 只匹配 `backend/README.md` 中一行：该行明确说明 `MemoryRepository` 仅为 test double、不是部署数据源。未匹配旧“内存仓储/重启丢失/共享账号/未接数据库/P0-B 或 P0-C 未开始”等实时断言。`git diff --check` exit 0；九个存活 Markdown 文件的 fenced code 与本地链接检查通过。

## 12. 文档与证据维护规则

- 以后执行 live 验收时，把日期、环境、命令、退出码、计数、ID 保持情况、viewport 尺寸和 console 计数追加到本文件；
- 不覆盖本次未执行记录；新证据应说明它关闭了哪个 PENDING 项；
- 只有第 9 节 1–12 全部无 PENDING 时，才能同步把 README 和 `PROJECT_ITERATION.md` 的 P0-B/P0-C/P0 改为完成；
- 历史 host-PID、进程内历史和共享账号方案只可存在于明确标记的历史记录，不能回到当前操作章节。
