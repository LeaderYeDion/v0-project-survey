# 2026-09-19 真实部署与 LLM 接入准备度检查

## 判断

**真实业务后端和三服务持久化部署已运行并通过本轮主要 live 验证；真实 LLM 执行层尚未完成。** 可以保留现有 API、用户归属、业务版本、Repository、PostgreSQL、分析和导出底座继续开发，不需要整体推倒重写。不能把“替换 MockEngine、填 API Key”视为已具备可靠推理能力。

P0 保持“现场部分验收通过，数据正确性问题待整改、完整浏览器矩阵待补”。本次发现非法选项答案被当作有效回答统计；五视口无页面溢出不等于所有账号、视口、业务路径的完整验收。

## 环境与本次修复

- Docker Desktop 启动后 Engine 为 29.5.3；最初无镜像、容器。
- 旧 `deploy.env` 缺少 Compose 项目名和 PostgreSQL 配置。先私密备份，再补齐缺失项；保留现有外围认证和凭据，生成五用户 seed。配置和备份未加入 Git。
- 直连 Docker Hub 超时；本机已有 `127.0.0.1:7890` 代理可达。Docker Desktop 设置为手动代理，宿主 BuildKit 命令额外传 `HTTP_PROXY`/`HTTPS_PROXY`。旧 Docker 设置备份在 `deploy/runtime/docker-settings-before-proxy.json`。本次没有创建公网入口。
- 首次镜像构建成功，但 backend 因 `/task_examples/survey/example.json` 缺失而反复重启；Alembic/seed 已成功。原 loader 依赖后端构建上下文之外、且被 Git 忽略的目录。
- **已修复**：将两份既有模板 JSON 原样纳入 `backend/app/mocks/data/{survey,chat}/example.json`，loader 使用相邻资源。新增仅复制 `app` 的独立进程导入回归测试：修复前复现 FileNotFoundError，修复后通过。重建镜像后真实 backend 健康。独立审查未发现实质问题。
- 业务源码变更只涉及模板资源打包；本报告列出的 LLM 和答案质量缺口尚未实施修复。未提交、未推送。

## 已执行证据

| 检查 | 结果与边界 |
| --- | --- |
| 后端自动化 | 修复后 174/174；包括独立打包回归 |
| 前端自动化 | 138/138 |
| 部署契约 | 70/70 |
| 类型与生产构建 | `tsc --noEmit`、本地生产构建、Docker frontend/backend 构建通过；本地初次构建受沙箱端口权限阻止，授权重跑成功 |
| 既有 Chrome 回归 | 4/4；两步登录及过时项目响应保护；使用 HTTP fixture，单独计，不冒充数据库验收 |
| 三服务 | frontend/backend/db 均 healthy；只向宿主发布 `127.0.0.1:3000`；迁移 `20260912_0002`；named volume `survey_survey_postgres_data` |
| 五账号 | 全部登录、`/me`、显式登出和随后 401、重新登录通过；其他四账号列表不含首账号项目，直接访问项目/问卷/版本/轮次/导出记录返回 404 |
| 草稿与版本 | PostgreSQL 保存；旧 revision 返回 409；修改草稿不改变历史配置；历史复制产生新问卷 |
| 运行控制 | 暂停→paused→继续→completed；4 受访者、2 题共 8 条答案；取消及未完成派生重试通过 |
| 分析与导出 | 总体计数正确；full/filtered JSON、CSV 成功；空 exceptions 返回 422 `EXPORT_SCOPE_EMPTY` |
| 非空异常与失败重试 | 独立验收执行器注入回答失败：2 失败样本真实入库；异常报告 count=2，exceptions JSON/CSV 成功；failed 派生重试经正常服务完成，原轮次保持失败 |
| 访谈推断 | 2 受访者，每人画像/态度各 1 条，共 4 条 Mock 推断结果持久化 |
| 持久化 smoke | `deploy/tests/persistence-smoke.sh` 通过：backend restart、普通 down/up（包含容器重建）、非空 mode-600 备份、两次隔离恢复、迁移/严格五用户、原轮次 ID 可访问、项目数量一致；隔离环境已清理 |
| 真实浏览器抽查 | 登录页、已登录工作区、持久化历史、冻结配置、历史复制、草稿自动保存（PATCH 后按 ID GET 复核）、问题分析口径与性别分组、JSON 实际下载与 succeeded 导出记录，以及点击启动→完成的一轮问卷模拟 |
| 五视口布局 | 390×844、768×720、1024×720、1280×720、1440×720：document scrollWidth/scrollHeight 均等于视口；历史结果截图留存。不是每个视口完整业务验收 |

浏览器自动保存的问卷为 `d6a66e60-6a5c-40b0-80c2-a60532e421b2`，revision=2，标题“浏览器自动保存验收 2026-09-19”；按 ID 再次 GET 确认持久化。刷新时界面默认选到了并行验收新建的另一个项目，未据此误判草稿丢失。

API 验收中曾修正两处验收脚本假设：`responses` 是每受访者聚合，需累计 `answers` 才是题目级数量；取消样本不属于现行 exceptions（只含终止/失败），因此用受控失败样本验证非空导出。这两项不是产品故障。

代表性轮次：

- 主要业务闭环：`cb710d5e-1076-47b6-b44f-2cc074fea819`，再次经 API 确认普通 down/up 后仍为 completed、4 人/8 答案。
- 持久化 smoke：`980ef878-3909-40fb-8e23-4cebc55c41fb`，两次隔离恢复通过。
- 故障注入：`a7c995cc-182e-4039-a113-e72102a668e8`；失败派生重试 `4ea18806-475a-4e70-8904-c8404d5c6e57` 完成。
- 正常 Mock 访谈：`0abdd4d2-24fc-4642-a9a2-f0870e788829`。

故障注入使用独立短生命周期进程、专用验收项目和真实 Repository；没有修改运行中后端的引擎或全局参数。验收项目和轮次保留，均为测试数据。

## 已确认问题与接入阻塞

### 1. 结果未按题目约束校验（当前即可复现）

自定义 `q1` 题目选项为 A/B，4 个已保存答案全部为“一般”。浏览器历史、下载和 API 一致，分析还把这些回答计为有效。`MockEngine.generate_answer` 只用 locale/mode/question.id 查样例；题目 ID 撞到默认模板后复用了不相关答案。`_answer_value_from_example` 不校验选项/量表范围，Pydantic 答案类型也不关联题目约束。

位置：`backend/app/mocks/engine.py:109`、`:157`；`backend/app/schemas/survey.py:153`；`backend/app/services/round_executor.py:323`、`:353`。

接入前应统一校验答案题型、choice 枚举、scale 范围、必需值与 questionId；错误输出不能进入“有效回答”。样例命中还应与题目语义/结构匹配，而不只看 ID。推断同样需要 options/multiple 和证据引用有效性校验。

### 2. 推断失败没有进入轮次失败/重试语义（真实 DB 复现）

轮次 `5d7d512a-a21e-41f0-bddd-fb0ecb0fb022` 的两条推断均为 failed，但轮次为 completed，completedRespondents=2、failedRespondents=0。当前服务捕获推断任务异常并产出 failed 结果，executor 仍无条件将受访者标成 completed；现有 failed 重试只选择失败受访者。

位置：`backend/app/services/inference_service.py:65`、`:100`；`backend/app/services/round_executor.py:402`–`:427`；`backend/app/repositories/rounds.py:513`。

应区分回答完成与推断完成，定义 completed_with_errors 的汇总口径，并提供推断任务级重试，保留已经成功的回答与推断。

### 3. 长调用与租约不兼容（默认租约的真实 DB 复现）

默认执行租约 30 秒，主要在回答/推断完成后的检查点续期，恢复巡检每 5 秒扫描。隔离执行器把租约缩为 1 秒并异步等待 7 秒后，轮次 `e3c1e31d-456a-4aac-b21f-26b74fc4e9a3` 被正常服务的恢复巡检置为 paused、`RUN_INTERRUPTED_BY_RESTART`，answeredQuestions=0；并没有真的发生重启。随后使用**原始默认 30 秒租约**、异步等待 37 秒再次复现：轮次 `903e51ab-fddc-4283-9a29-ea17f7de9aed` 为 paused、`RUN_INTERRUPTED_BY_RESTART`、answeredQuestions=0。两次均为独立进程模拟慢调用，没有请求真实供应商。

位置：`backend/app/services/round_executor.py:43`、`:322`、`:408`；`backend/app/services/recovery_service.py:17`；`backend/app/repositories/rounds.py:541`。

需要独立续租/heartbeat、严格 lease-owner fencing，以及覆盖请求、重试、暂停/取消和关闭的总 deadline。`maxResponseTime` 目前只是冻结配置字段，未用于限制回答或推断调用。上述默认租约测试的 maxResponseTime=30，但等待 37 秒并未通过调用超时逻辑收敛。

### 4. 尚无真实模型适配层

`main.py` 固定装配 MockEngine 和规则式 InferenceService。SimulationEngine 的 generate_answer 是同步函数，直接在事件循环执行；仅模拟等待为 async。签名没有完整访谈历史、研究上下文或调用标识。直接塞同步 SDK 会阻塞请求与控制动作。

位置：`backend/app/main.py:62`–`:94`；`backend/app/services/simulation_engine.py:13`；`backend/app/services/round_executor.py:323`。

最小接口需要 async provider client、明确 mock/real 模式、启动校验、客户端生命周期、上下文构建，以及统一的拒答/格式错误/超时/限流/供应商错误码。

### 5. backend 当前没有外部 API 出网路径

Compose backend 仅连接 `app_internal`，该网络 `internal: true`。保留 db 的隔离，为 backend 增加可控出网网络或代理，并通过服务端 secret 注入模型凭据。Docker Desktop 拉镜像的宿主代理配置不等于业务容器已获得模型调用能力。

位置：`compose.yaml:40`、`:105`。本结论来自配置；尚未向真实模型端点做业务请求。

### 6. 现有检查点不足以追溯外部调用与费用

现有回答级事务、CAS、不可变业务配置可保留，但缺少 provider、实际模型版本、prompt/template 版本、采样参数、供应商 request ID、usage、耗时、attempt、调用结果状态。模型返回后、检查点提交前崩溃可能重复调用；不应承诺外部调用 exactly-once。

位置：`backend/app/db/models.py` 的 ConfigVersionRow/MessageRow/InferenceResultRow；`backend/app/services/round_executor.py:349`、`:402`。

建议新增模型调用记录并关联答案/推断，冻结非敏感执行配置，使用稳定调用键及可复用结果，明确不确定结果的重试策略。密钥不能进入版本快照或导出。

### 7. 取消/暂停和资源限制需要面向付费请求设计

现有暂停是题目检查点处协作暂停；取消主要改变数据库状态，不直接取消在途模型请求，也没有推断任务间取消检查。当前每轮一个进程内 task、轮内串行，无全局并发/供应商限额/费用预算。

小规模第一版可保留进程内执行器，但必须有并发上限、请求总超时、有界重试/退避、取消信号和 token/费用上限。独立 Worker、持久任务队列、多租户调度可作为后续规模化工作；不能把这些规模化设施当成首次接入的全部先决条件。

### 8. 依赖与界面收尾

- `npm audit --omit=dev` 返回 7 个生产依赖问题：1 critical、5 high、1 moderate；包含直接依赖 Next.js 16.1.6。报告等级是依赖审计结果，**不等于本部署已确认可利用**。例如部分公告限定 Windows 或 Image Optimization；本部署是 Linux 且 `images.unoptimized=true`。升级后需重新验证 rewrites、外围认证、登录和构建，正式开放公网前完成处置。
- 登录页 Vercel Analytics 请求 401，登录后请求 404；存在 Select uncontrolled→controlled 警告。
- 390px 历史态顶部保存状态与项目/问卷控件拥挤，需要专项可用性检查；无页面溢出不能排除局部重叠或操作困难。
- 镜像基础标签会浮动：本次容器 Python 实际为 3.14.7；建议记录/固定交付镜像 digest，避免把文档中的本地 3.14.6 当成容器运行版本。

## 下一轮建议顺序与验收门

1. **先修正确性**：题目关联输出校验、Mock ID 碰撞、推断失败状态和任务级重试；增加以上三个已复现问题的回归。
2. **完成最小 LLM 执行契约**：异步模型边界、上下文、后端出网/secret、总超时、续租、取消、限流和预算；保持现有 API/Repository 边界。
3. **补可追溯性**：执行配置/提示词版本、调用记录、usage、attempt、结果复用、失败分类与日志脱敏；通过 Alembic 演进。
4. **一个 provider、一个模型、小样本纵向打通**：问卷生成/回答/访谈推断分别明确职责和输出 schema，不一次实现所有模型或自动报告功能。
5. **故障矩阵再放大规模**：模拟超时、429、5xx、拒答、非法 JSON、进程中断、DB 提交失败；验证超租约调用不会误暂停、取消后不再启动新调用、成功结果不被失败重试覆盖、费用有界。真实模型评测需固定小型题库，对比有效率、证据质量、一致性、延迟和 token 成本。

还需补齐：五账号×五视口全业务浏览器矩阵、实际终止样本的 UI 下钻、全部导出范围的浏览器操作与正式依赖升级回归。Quick Tunnel 是可选项，本次未执行。真实 LLM API 尚未配置或调用。

## 本机证据位置

`deploy/runtime/`（Git 忽略）保留：`live-audit-20260919.log`、`persistence-smoke-20260919.log`、`exception-audit-20260919.log`、`durable-recheck-20260919.json`、`inference-failure-20260919.json`、`lease-audit-20260919.json`、`default-lease-audit-20260919.json`、`npm-audit-20260919.json` 及验收脚本。浏览器截图与快照保存在同目录的 `browser-cli-20260919/`、`browser-screenshots-20260919/` 子目录，凭据/会话状态文件不得提交或分享。
