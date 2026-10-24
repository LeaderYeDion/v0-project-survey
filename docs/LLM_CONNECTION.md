# 模型接入与本轮预验收操作

默认 `SIMULATION_ENGINE=mock`；不配置模型即可继续原 Demo。应用登录/持久化仍需要 PostgreSQL 和已有用户种子。新增迁移 `20260927_0003` 仅增加可空 `execution_context`，不清理旧数据。

## HTTP 模式

首个适配器仅支持非流式 chat-completions 风格接口：POST 完整 URL，请求包含 `model` 和 `messages`，响应读取 `choices[0].message.content`。content 必须是 JSON 字符串，例如：

```json
{"questionId":"q1","content":"我支持这一政策。","answerValue":{"type":"choice","value":"支持"}}
```

`type` 为 text/choice/scale；单选值必须来自题目选项，量表必须为 JSON 数字且在范围内，文本不能为空。模型不负责生成资源 ID、时间或归属。首版不处理 Markdown 代码围栏、流式 token、工具调用或供应商专用响应格式；真实端点需验证兼容性。

| 服务端变量 | 含义 |
| --- | --- |
| `SIMULATION_ENGINE` | `mock`（默认）或 `http` |
| `LLM_ENDPOINT` | 完整 HTTP(S) chat-completions URL，不含凭据、query、fragment |
| `LLM_MODEL` | 模型名称，HTTP 必填 |
| `LLM_SOURCE` | `test`、`cloud` 或 `local`，HTTP 必填 |
| `LLM_AUTH_REQUIRED` | `true`/`false`；直接启动时 cloud 默认 true，其余 false；Compose override 默认 true |
| `LLM_API_KEY` | 服务端 Bearer 凭据；不能使用 `NEXT_PUBLIC_` 变量 |
| `LLM_API_KEY_FILE` | 直接启动可从服务端文件读取，优先于环境 Key；Compose 使用时需自行挂载并传入路径 |
| `LLM_TIMEOUT_SECONDS` | 默认 60，范围 `(0,600]`；每次调用还受问卷 `maxResponseTime` 限制 |

HTTP 配置缺失时启动失败；调用失败时保留已保存回答并产生错误状态，不回退 Mock。执行租约覆盖模型超时再加 10 秒；取消后的迟到回答不会提交。访谈按固定提纲顺序调用，每位受访者有独立历史。无需 Agent 框架，沿用现有进程内轮次执行器。

轮次保存 source/model 和冻结研究目标；凭据不入快照。旧轮次缺少来源时显示“旧版/来源未记录”。切换配置后历史仍按原来源展示；暂停轮次不能跨 source/model 继续，可新开一轮。HTTP 模式不生成 Mock 情绪/画像/态度推断；Mock 辅助功能继续保留。

## 无 Key/GPU 的本地检查

先按 backend README 准备独立 PostgreSQL、执行迁移及用户 seed。在仓库根目录启动开发专用端点：

```bash
backend/.venv/bin/python backend/tests/model_fixture.py
```

另一个终端启动后端（DATABASE_URL 使用自己的测试库）：

```bash
export SIMULATION_ENGINE=http
export LLM_ENDPOINT=http://127.0.0.1:8999/v1/chat/completions
export LLM_MODEL=mainline-fixture
export LLM_SOURCE=test
export LLM_AUTH_REQUIRED=false
npm run dev:backend
```

再运行 `npm run dev`。测试端点仅显式启动；默认绑定本机 8999，Ctrl-C 停止。GET `/requests` 可查看不含认证头的请求记录；题目包含 `[delay=2]`、`[error]`、`[invalid]` 分别控制延迟、503、非法 JSON。正常文本含 `HTTP FIXTURE`，不能作为真实模型质量证据。

浏览器验收使用已安装的 Playwright 与 Chrome；不由测试下载依赖。测试用户 researcher01/02 应存在，并使用同一指定测试密码。会创建独立测试项目，故仅指向测试部署：

```bash
MAINLINE_BASE_URL=http://127.0.0.1:3000 \
MAINLINE_TEST_PASSWORD='<测试用户密码>' MAINLINE_SOURCE=test \
node --test tests/browser/mainline.test.mjs
```

若 Playwright 不在项目依赖中，可用 `PLAYWRIGHT_MODULE` 指向已安装的 `playwright/index.mjs`。测试输出轮次 ID；`MAINLINE_SOURCE=mock` 跑默认 Mock 四组合。HTTP fixture 请求检查使用本机 8999。截图写入 `deploy/runtime/mainline/`（运行前创建该目录）。

可选真实 DB 对照/旧数据迁移验收（仅允许一次性测试库，账号须有创建数据库权限）：

```bash
cd backend
DATABASE_URL='<测试库 URL>' MAINLINE_DISPOSABLE_DB=true \
MAINLINE_BROWSER_LOG='<浏览器日志绝对路径>' .venv/bin/python tests/live_mainline_db.py
```

该脚本对照四个成功轮次，并创建专用临时库测试 0002 → 0003，最后删除其创建的临时库，不清空传入数据库。

## Compose 切换与实际资源到位后

默认 `compose.yaml` 维持 Mock 和原内部网络。HTTP 模式显式叠加 `compose.llm.yaml`，为 backend 增加模型出网网络；在私有部署环境文件填写上表配置后执行：

```bash
docker compose --env-file deploy/config/deploy.env -f compose.yaml -f compose.llm.yaml up --build -d
```

Docker 内的 `127.0.0.1` 指容器自身；模型地址必须从 backend 可达，例如已部署的模型服务地址。开发 fixture 无需加入默认生产 Compose。

切回 Mock 使用原 Compose 并重建 backend 配置，不删除卷：

```bash
docker compose --env-file deploy/config/deploy.env -f compose.yaml up -d --force-recreate backend
```

资源到位后只选择一个实际云端或本地服务，设置 `LLM_SOURCE=cloud/local`、真实 model/endpoint/认证，运行清单第 6 节及 M0–M6 小样本。需要实测协议兼容、语言与角色输出、访谈上下文效果和实际超时。GPU 驱动、权重及推理服务部署另在实际机器上完成；本仓库不会自动部署模型权重。
