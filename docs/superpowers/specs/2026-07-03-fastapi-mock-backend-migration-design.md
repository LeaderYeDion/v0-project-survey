# FastAPI Mock 后端第一版迁移设计

日期：2026-07-03

## 1. 背景

当前调研产品的业务闭环由前端 React 状态与 `lib/mock-survey-service.ts` 共同完成。前端负责：

- 维护调研配置；
- 生成虚拟受访者；
- 初始化和执行逐受访者、逐问题循环；
- 生成 Mock 回答；
- 判断受访者或调研方是否终止；
- 维护运行进度；
- 计算情绪、问题和人口维度统计；
- 保存内存历史；
- 拼装 JSON/CSV 导出文件。

本次迁移的目标不是引入真实模型、数据库或生产级任务队列，而是将以上业务逻辑整体从前端移入 `backend/` 中的 FastAPI 服务。迁移完成后，页面外观、内容、交互节奏和可见功能应与迁移前一致。

完整迁移范围参考 `docs/MOCK_BACKEND_MIGRATION_CHECKLIST.md`。本文只定义第一版 Mock 后端迁移的具体边界。

## 2. 目标

### 2.1 核心目标

- 使用 Python 3.14.6 和 FastAPI 建立后端。
- 在 `backend/` 内建立项目本地 Python 运行时、`.venv` 和 pip 依赖环境。
- 将生产调用链中的 Mock 业务逻辑迁移至后端。
- 前端只负责用户输入、界面状态和内容渲染。
- 统一前后端接口和出入参协议。
- 保持迁移前后的页面布局、文案、图表和用户流程一致。

### 2.2 第一版非目标

- 不接入真实大模型。
- 不接入数据库。
- 不引入 Redis、Celery、Kafka 等外部任务基础设施。
- 不建设多用户权限、项目协作或正式审计系统。
- 不新增暂停、继续、失败重试等当前页面没有的交互。
- 不改变现有产品视觉设计和信息架构。
- 不将轮询升级为 SSE 或 WebSocket。

## 3. 决策与方案比较

### 3.1 采用方案

采用“FastAPI 完整执行运行任务，前端轮询运行快照”的方案。

FastAPI 在内存中创建运行记录，并通过应用内异步任务完成受访者生成、逐题模拟、终止判断和统计更新。前端创建运行后，只按固定周期获取最新快照并渲染。

### 3.2 未采用方案

#### 前端保留编排、逐函数请求后端

该方案改动较小，但逐受访者循环、状态迁移和统计触发仍在前端，不符合“业务逻辑全部由后端负责”的目标。

#### FastAPI 通过 SSE 推送状态

该方案实时性更好，但会增加连接恢复、代理缓存和事件一致性处理。第一版采用轮询，后续可在不改变运行快照协议的前提下升级传输方式。

## 4. 总体架构

```text
Browser
  │
  │ /survey-api/*
  ▼
Next.js Rewrite
  │
  │ /api/*
  ▼
FastAPI
  ├── API Routers
  ├── Run Service
  ├── Mock Engine
  ├── Analytics Service
  ├── Export Service
  └── In-memory Repository
```

Next.js Rewrite 仅做透明转发，不包含调研业务逻辑。浏览器始终请求同源路径 `/survey-api/*`，避免开发和部署环境中的浏览器 CORS 配置。

FastAPI 默认监听 `127.0.0.1:8000`。Next.js 通过环境变量读取后端地址，默认值为 `http://127.0.0.1:8000`。

## 5. 后端目录设计

```text
backend/
├── .python-version
├── .venv/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── analytics.py
│   │   ├── exports.py
│   │   ├── history.py
│   │   ├── runs.py
│   │   └── templates.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── analytics.py
│   │   ├── common.py
│   │   ├── history.py
│   │   └── survey.py
│   ├── repositories/
│   │   ├── __init__.py
│   │   └── memory.py
│   └── services/
│       ├── __init__.py
│       ├── analytics_service.py
│       ├── export_service.py
│       ├── mock_engine.py
│       └── run_service.py
├── tests/
├── requirements.txt
├── requirements-dev.txt
└── README.md
```

职责边界：

- `schemas`：Pydantic 请求、响应和领域数据模型。
- `repositories`：运行与历史记录的内存存取，不包含业务计算。
- `services/mock_engine.py`：随机受访者、回答、情绪和终止逻辑。
- `services/run_service.py`：运行状态机、任务编排和快照生成。
- `services/analytics_service.py`：情绪、问题、人群、筛选和分组统计。
- `services/export_service.py`：JSON/CSV 文件生成。
- `api`：HTTP 参数校验、服务调用和响应映射。

## 6. Python 环境

本机当前系统 Python 为 3.9.6，不能用于本项目后端。后端必须使用精确版本 Python 3.14.6。

实现要求：

- 使用项目脚本临时引导 `uv`，将 Python 3.14.6 安装到 `backend/.python/`，不替换 macOS 系统 Python。
- 使用该运行时创建 `backend/.venv`。
- 使用 `backend/.venv/bin/python -m pip` 安装依赖。
- `backend/.python-version` 固定为 `3.14.6`。
- `.venv` 和本地 Python 二进制目录不提交 Git。
- `backend/scripts/bootstrap.sh` 负责安装本地运行时、创建虚拟环境和安装 pip 依赖，重复执行必须安全。
- 提交锁定版本的 `requirements.txt` 和 `requirements-dev.txt`。
- `backend/README.md` 给出环境重建、启动和测试命令。

运行依赖至少包括：

- FastAPI
- Uvicorn
- Pydantic

开发依赖至少包括：

- pytest
- pytest-asyncio
- HTTPX

## 7. 数据协议

### 7.1 命名与时间

- HTTP JSON 字段沿用前端当前 camelCase 命名，减少组件改动。
- 所有时间通过 ISO 8601 字符串传输。
- 服务端使用 UUID 生成运行、历史、受访者和消息 ID。
- 前端不得使用调研标题作为 `surveyId`。

### 7.2 主要类型

后端协议需要覆盖并兼容以下现有前端概念：

- `SurveyConfig`
- `RespondentConfig`
- `SurveyQuestion`
- `RespondentProfile`
- `DialogMessage`
- `InterviewSession`
- `SurveyResponse`
- `SurveyProgress`
- `SentimentData`
- `QuestionAnalysis`
- `DemographicAnalysis`
- `SurveyHistoryRecord`
- `DimensionMetadata`
- `DimensionFilters`
- `DimensionGroup`

回答必须依据题型保存：

```text
text   → { type: "text", value: string }
choice → { type: "choice", value: string }
scale  → { type: "scale", value: number }
```

这会修复当前 `buildSurveyResponses` 将所有字符串归类为 `choice` 的问题，但不会改变页面显示内容。

### 7.3 运行快照

`GET /api/runs/{runId}` 返回前端渲染所需的完整快照：

```json
{
  "id": "run-uuid",
  "mode": "survey",
  "status": "running",
  "config": {},
  "respondents": [],
  "sessions": [],
  "progress": {},
  "sentiment": {},
  "questionAnalysis": [],
  "demographicAnalysis": [],
  "responses": [],
  "activeRespondentId": null,
  "createdAt": "2026-07-03T12:00:00Z",
  "startedAt": "2026-07-03T12:00:00Z",
  "finishedAt": null,
  "error": null
}
```

前端以快照替换本地业务状态，不自行重新计算派生数据。

## 8. API 设计

所有 FastAPI 业务接口使用 `/api` 前缀；浏览器通过 `/survey-api` 前缀访问。

### 8.1 健康检查

```http
GET /api/health
```

返回服务状态和 Python 版本，用于启动脚本与开发诊断。

### 8.2 默认模板

```http
GET /api/templates/default
```

返回当前 `defaultSurveyConfig` 的等价内容。前端页面初始化时从后端加载该模板。

### 8.3 运行任务

```http
POST /api/runs
GET  /api/runs/{runId}
POST /api/runs/{runId}/cancel
```

创建请求：

```json
{
  "mode": "survey",
  "config": {}
}
```

`POST /api/runs` 在内存中创建记录、启动应用内异步任务，并立即返回初始运行快照。

第一版运行状态：

```text
queued
running
completed
failed
cancelled
```

取消接口为后端能力保留。当前页面没有取消按钮，本次不新增 UI。

### 8.4 历史记录

```http
POST /api/history
GET  /api/history
GET  /api/history/{historyId}
```

保存历史请求只传 `runId`。后端从运行仓储复制快照，前端不上传统计结果。

历史列表为兼容现有 UI，第一版可返回完整 `SurveyHistoryRecord[]`。后续数据库版本再拆分摘要列表和详情加载。

### 8.5 分析查询

```http
POST /api/runs/{runId}/analytics/query
POST /api/history/{historyId}/analytics/query
```

请求：

```json
{
  "questionId": "q1",
  "filters": {
    "gender": "男",
    "city": "北京"
  },
  "groupBy": ["income", "occupation"]
}
```

响应包含：

- `dimensionMetadata`
- `filteredRespondentCount`
- `totalRespondentCount`
- `filteredQuestionAnalysis`
- `groupedQuestionSummaries`

筛选条件、选中问题和分组按钮仍属于前端 UI 状态；筛选和统计计算属于后端业务逻辑。

### 8.6 导出

```http
GET /api/runs/{runId}/exports?format=json
GET /api/runs/{runId}/exports?format=csv
GET /api/history/{historyId}/exports?format=json
GET /api/history/{historyId}/exports?format=csv
```

后端返回文件响应。前端只触发下载。

CSV 输出保持现有列：

```text
respondentId,name,city,status,completedQuestions,terminationReason
```

同时补充正确的 CSV 转义，避免姓名、城市或终止原因中的逗号和换行破坏结构。

## 9. Mock 运行逻辑

后端 `MockEngine` 迁移当前行为：

- 按受访者配置数量生成画像。
- 按性别、年龄、职业、城市和收入填充属性。
- 生成姓名、昵称、头像、教育、婚姻状态和标签。
- 按问题类型生成量表、选择和文本回答。
- 生成 positive、neutral、negative 情绪。
- 模拟受访者主动终止。
- 模拟低质量回答和调研方终止。
- 保留当前问题间和回答间的可见延时，使页面运行节奏基本一致。

随机逻辑集中在可注入的随机数生成器中。测试使用固定种子和零延时，生产 Mock 使用随机种子和现有近似延时。

## 10. 前端改造

### 10.1 API Client

`lib/survey-api.ts` 改为纯 HTTP Client：

- 默认请求 `/survey-api`。
- 提供模板、运行、历史、分析和导出方法。
- 统一处理非 2xx 响应。
- 支持 `AbortSignal`。
- 不再导出 Mock 业务函数。

共享 TypeScript 类型迁移到 `lib/survey-contract.ts`；`lib/survey-api.ts` 负责重新导出这些类型，使现有组件可以逐步迁移且不依赖 Mock 实现。

### 10.2 页面状态

`app/page.tsx` 删除：

- `apiGenerateRespondentsFromConfig` 调用；
- Session 初始化；
- 逐受访者循环；
- 逐问题循环；
- `askQuestion` 调用；
- `shouldInterviewerTerminate` 调用；
- 情绪和统计计算；
- `apiBuildSurveyResponses` 调用；
- 人工回答延时。

页面保留：

- 当前配置；
- 当前运行快照；
- 是否运行；
- 当前展示模式；
- 当前工作区；
- Sheet/Dialog 开关；
- 当前历史记录；
- 轮询定时器与卸载清理。

### 10.3 分析面板

`AnalyticsPanel` 删除客户端可信统计逻辑：

- `analyzeQuestionResponses`
- `filterRespondentsByDimensions`
- `getDimensionMetadata`
- `groupRespondentsByDimensions`

筛选或分组变化时调用分析查询接口，并渲染返回结果。

### 10.4 Mock 文件

- `components/chat-simulation-panel.tsx` 改为从共享 Contract 引用类型。
- `lib/mock-survey-service.ts` 从生产调用链移除。
- 若前端测试仍需要样例数据，将样例放入测试 Fixture，不保留生产导入。

## 11. 错误处理

后端统一返回：

```json
{
  "detail": {
    "code": "RUN_NOT_FOUND",
    "message": "运行记录不存在"
  }
}
```

第一版至少覆盖：

- 配置校验失败：HTTP 422。
- 运行或历史不存在：HTTP 404。
- 不支持的导出格式：HTTP 400。
- 已结束运行重复取消：返回当前快照，不创建新状态。
- 后台任务异常：运行状态设为 `failed`，快照保存错误消息。
- FastAPI 不可用：前端结束加载状态，在控制台记录错误，并保留现有页面结构。

本次不新增大面积错误 UI，以避免改变页面；但运行按钮必须恢复可用，不能因请求失败永久停留在运行状态。

## 12. 运行与部署

开发时分别启动：

```text
FastAPI: 127.0.0.1:8000
Next.js: 127.0.0.1:3000
```

Next.js Rewrite 的目标由 `SURVEY_BACKEND_URL` 配置。

根目录保留现有 `npm run dev`，并增加 `npm run dev:backend` 与 `npm run dev:full`。`dev:full` 通过 `backend/scripts/dev-full.sh` 同时启动两个进程，并在退出时清理子进程。后端也可独立通过 `backend/.venv/bin/uvicorn app.main:app` 启动。

现有 Cloudflare 部署脚本不在第一版强制改造范围内；文档必须明确当前组合启动方式。若现有构建或浏览器验证依赖后端，则测试流程应显式启动 FastAPI。

## 13. 测试策略

### 13.1 后端单元测试

- Pydantic 配置和题型校验。
- 受访者数量、字段和标签生成。
- 文本、选择和量表回答类型。
- 受访者与调研方终止。
- 情绪百分比。
- 问题回答分布和平均分。
- 人口维度统计。
- 筛选和多维分组。
- JSON/CSV 导出。
- 历史快照复制。

### 13.2 后端 API 测试

- 健康检查和 Python 版本。
- 默认模板。
- 创建运行、查询运行直至完成。
- 取消运行。
- 保存、列表和读取历史。
- 当前运行与历史分析查询。
- 当前运行与历史导出。
- 404、422 和非法格式错误。

### 13.3 前端验证

- TypeScript/Next.js 构建通过。
- 前端生产代码不再导入 `mock-survey-service.ts`。
- `app/page.tsx` 不再包含逐受访者和逐问题业务循环。
- 分析面板不再调用客户端统计函数。

### 13.4 端到端验证

迁移前记录桌面端核心页面和交互基线。迁移后同时启动 FastAPI 与 Next.js，验证：

- 默认配置正常展示。
- 问卷模式能够运行并渐进显示结果。
- 访谈模式能够运行并显示受访者和对话。
- 进度、情绪和统计持续更新。
- 保存历史、打开历史和返回当前运行正常。
- 性别、年龄、职业、城市、收入筛选正常。
- 多维分组正常。
- JSON 和 CSV 下载正常。
- 页面布局、文案和主要视觉内容无回归。
- 浏览器控制台无未处理错误。

## 14. 验收标准

- 后端实际运行版本为 Python 3.14.6。
- `backend/.venv` 存在且 pip 依赖可重建。
- FastAPI 健康检查、OpenAPI 和全部业务接口可用。
- 所有 Mock 业务计算位于 `backend/`。
- 前端通过 HTTP 获取运行、历史、分析和导出数据。
- 前端不再从 `lib/mock-survey-service.ts` 导入生产逻辑或类型。
- 刷新前端页面不会清空 FastAPI 进程内已保存的历史。
- 重启 FastAPI 后内存数据丢失属于第一版预期行为。
- 页面打开和核心操作在视觉与内容上保持迁移前行为。
- 后端测试、前端构建和端到端核心流程验证通过。

## 15. 后续演进

第一版稳定后，可以保持 API Contract 基本不变，逐步替换内部实现：

1. 内存仓储替换为数据库。
2. 应用内异步任务替换为正式任务队列。
3. Mock Engine 替换为真实模型或真实受访者输入。
4. 轮询替换为 SSE/WebSocket。
5. 历史列表拆分摘要与详情。
6. 增加认证、权限、审计和多项目模型。
