# 资源到位前主线验收记录（2026-10-10）

## 结论与范围

A0–A7 接入准备与受控 HTTP 端点闭环完成，默认 Mock 兼容通过。已验证登录/选语言、最新角色和题目保存、HTTP 回答、页面展示、PostgreSQL 落库、刷新/重新登录回看。未调用实际云端/GPU 模型，不宣称真实模型质量或正式生产上线完成。

代码位于 `real-backend-v1` 工作区，尚未提交。必需模板及新增运行文件纳入本轮交付。默认 Mock 无需模型配置；HTTP 显式配置且不静默回退。沿用现有执行器，没有引入 Agent 编排框架。

## 环境与最终检查

macOS、Node 24、Python 3.14.6、真实 Chrome/Playwright；独立 PostgreSQL 17 容器 `survey-mainline-check-db`（本机 55439），测试 backend 8101、frontend 3101、fixture 8999。现有 3000 端口 Docker 部署与其数据库没有改动。验收结束已停止本轮三个测试进程、删除隔离测试数据库容器；原 frontend/backend/db 仍健康。上述测试轮次不在原 Demo 数据库内。

| 命令/检查 | 最终结果 |
| --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests -q` | 196 passed，5.26 s |
| `npm run test:frontend` | 140 passed |
| `node --test deploy/tests/*.test.mjs` | 70 passed，13.43 s |
| `npm run typecheck` | exit 0，独立检查，未依赖 Next 的忽略类型设置 |
| `node node_modules/next/dist/bin/next build` | exit 0，编译 3.0 s，静态生成 5/5 |
| 仅 `git ls-files backend/app` 复制到临时目录导入 | app 与两模板通过，未依赖目录外资源 |
| Compose 默认文件叠加 `compose.llm.yaml` 后 `config --quiet` | exit 0；只校验配置，未更新现有部署 |
| `tests/browser/mainline.test.mjs`，`MAINLINE_SOURCE=mock` | 5/5，55.88 s |
| 同一浏览器脚本，`MAINLINE_SOURCE=test` | 6/6，22.14 s |
| `tests/browser/mainline-history.test.mjs`，HTTP→Mock 重启对照 | 1/1，完整快照相等 |
| `backend/tests/live_mainline_db.py`，分别输入 Mock/HTTP 浏览器日志 | 两组各四轮 DB/API 对照通过；0002→0003 旧行保持不变 |
| 旧来源浏览器及草稿编辑探针 | 缺字段来源显示 Legacy/unrecorded；编辑草稿不改变历史快照 |

受限环境的首次构建无进展，停止后在允许本地编译进程/网络的执行环境构建成功。仍有既有 Babel 配置提示；未为此扩大修改。浏览器历史探针最初在初始化尚未结束时预置 localStorage，导致测试时序失败；等待初始化完成后复验通过。原异常报告断言依赖随机 Mock 文案，已改为对照实际冻结回答及合法选项。

运行日志和截图位于忽略的 `deploy/runtime/mainline/`，本报告及测试脚本是可交付证据。早期 `/tmp` 日志被环境清理后，本次重新保存最终记录，不使用遗失日志充当最终测试计数。

## 最终主线轮次

每轮 2 位受访者。问卷覆盖 text/choice/scale（单选）共 6 答；访谈两题共 4 答。

| 来源 | 语言 | 模式 | round ID |
| --- | --- | --- | --- |
| Mock | en-US | survey | `eebd36c7-d877-4deb-afcb-437f575095b6` |
| Mock | en-US | interview | `4bc1a301-55b4-4a46-b31e-a4bc693016ae` |
| Mock | zh-CN | survey | `9f6645b9-586a-4daf-80e7-84d1c99b17cb` |
| Mock | zh-CN | interview | `9a37bdb5-abc6-40da-999f-417266462720` |
| test/mainline-fixture | en-US | survey | `2b7c82d7-c5c7-4113-a422-9f3a5c24f07c` |
| test/mainline-fixture | en-US | interview | `1da051d6-4946-4071-8452-394dc71860a7` |
| test/mainline-fixture | zh-CN | survey | `ccb46822-0550-4d51-a550-db241ea80d46` |
| test/mainline-fixture | zh-CN | interview | `7bdfcaf5-5ceb-44ec-bb32-ae3b95ae7c15` |

浏览器实际登录、UI 创建项目、通过 owner API 准备小问卷后 UI 修改描述/城市并启动；立即编辑时 Start 禁用，保存成功后才运行。端点断言 locale、角色城市、研究目标，访谈历史长度按受访者为 `[0,2,0,2]`。页面实际回答可见；刷新、关闭再打开、退出重登均回到同一结果，调用计数不增长。Mock 访谈原辅助推断仍产生结果，HTTP 推断为空且页面明确未启用。

## A4–A6 边界证据

- 边界轮次 `71435792-eb98-4483-aae4-0b36fa961770`：首题成功、第二题 HTTP 503，最终 `completed_with_errors`、保留 1 答；刷新与切换登录语言后可回看。第二账号请求该轮次为 404。
- 同一浏览器测试延迟旧轮次 GET 后启动新轮次，旧响应不得覆盖新状态；调用中配置禁用，不再因编辑清除运行控制。
- 严格 HTTP 校验拒绝布尔值/字符串量表、非法 JSON、选项外值、越界量表、空文本、题型不符；错误不产生有效答案。模型题目 ID 必须匹配当前题目。
- 慢调用边界采用等价时钟探针：HTTP timeout=60 秒，巡检时间推进 31 秒（超过旧 30 秒租约）不会恢复为暂停；随后回答正常完成。超时测试 timeout=0.05 秒、请求等待 1 秒后进入明确错误。取消后释放迟到返回，答案数仍为 0，不发下一题；没有宣称真实等待长达 31 秒。
- HTTP 模式下回读原 Mock 轮次 `de11674d-91df-481a-8616-e82ecfd96e92`，并记录 HTTP 轮次 `168da798-1d7e-411c-907c-ab7970b34627`；重启切回 Mock 后两者完整 API 快照相等、浏览器来源不变、fixture 调用不增加。
- 单独测试库内，将测试轮次 `bbfed70e-6443-459f-8215-5a5b4a234819` 的来源设为空以模拟旧版；草稿编辑后整个旧轮次快照不变，浏览器显示 Legacy/unrecorded。这是模拟旧版读取检查，不冒称该记录来自真实旧部署。
- 真正迁移检查另外创建临时 PostgreSQL 库，升级至 0002，写入已有轮次及其依赖，再升级 0003；旧轮次所有原字段完全相同，新字段 NULL。脚本只删除自己创建的临时库。

## 改动与后续门

统一固定画像和既有答案契约，通过异步 `answer` 进入同一执行器/检查点。HTTP 请求带冻结研究背景及同受访者历史；source/model 持久化。默认 Mock 保留，模型配置仅在服务端。无完整调用账本、GPU 权重部署、Agent 框架或额外调度系统。

后续仅按 [接入说明](../LLM_CONNECTION.md) 配置一个实际模型，执行 [清单第 6 节](../PRE_LLM_MAINLINE_CHECKLIST.md#6-资源到位后才能关闭的验收本轮不等待)：协议适配、真实输出格式/语言/角色与上下文效果、实际延迟、同样的小样本保存回看。第二来源、质量优化、辅助推断、完整故障矩阵和正式运维继续后置。
