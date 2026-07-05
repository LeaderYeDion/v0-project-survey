# Mock 逻辑后端迁移清单

## 1. 文档目的

本文档盘点当前项目中由 Mock 服务和浏览器内存承担的调研业务逻辑，并给出迁移至真实后端接口的范围、建议接口、实施顺序和验收标准。

本文档最初盘点时，项目除部署登录接口外还没有调研业务后端；任务配置、受访者生成、问卷与访谈执行、运行进度、历史记录、统计分析和结果导出均在前端或 Mock 服务中完成。当前实现状态以紧随其后的“第一版迁移状态”为准。

## 第一版迁移状态（2026-07-03）

第一版已经完成“逻辑位置迁移”，但尚未完成真实能力替换：

- [x] Python 3.14.6 + FastAPI 后端及项目本地虚拟环境。
- [x] 默认模板和接口 Contract。
- [x] Mock 受访者、回答、情绪和终止逻辑迁至后端。
- [x] 后端运行任务、进度和取消接口。
- [x] 后端内存历史保存与回放。
- [x] 后端问题统计、人群统计、筛选和多维分组。
- [x] 后端 JSON/CSV 导出。
- [x] 前端生产路径删除 `mock-survey-service.ts` 和业务编排。
- [x] 中英文 Mock 模板、画像、回答、终止原因和分析标签。
- [x] 运行与历史记录固化语言，后续请求不改写业务数据。
- [x] Mock 数据与行为收口到 `backend/app/mocks/`，通过协议注入通用服务。
- [ ] 真实模型调用。
- [ ] 数据库持久化。
- [ ] 正式任务队列、SSE/WebSocket、权限和审计。

下文保留完整目标清单；其中数据库、真实样本、真实模型和生产基础设施仍属于后续迁移。

## 2. 迁移前 Mock 逻辑分布

| 模块 | 当前位置 | 当前行为 | 后端迁移目标 |
| --- | --- | --- | --- |
| 数据类型与 API 门面 | `lib/survey-api.ts` | 转发 `mock-survey-service`，没有真实 HTTP 请求 | 改为真实 API Client；类型迁移至独立 Contract |
| Mock 核心服务 | `lib/mock-survey-service.ts` | 承担受访者生成、问答模拟、统计、历史和导出等逻辑 | 接口完成后删除，或仅保留为开发 Fixture |
| 默认问卷与人群 | `lib/mock-survey-service.ts` | 硬编码默认问题和受访者配置 | 调研模板或草稿配置接口 |
| 任务编排 | `app/page.tsx` | 浏览器逐受访者、逐问题执行任务 | 后端任务服务与任务队列 |
| 当前运行数据 | `app/page.tsx` | Session、Respondent、Progress、Analysis 等全部存放在 React State | 服务端持久化；前端只保留展示缓存 |
| 配置编辑 | `components/survey-config-panel.tsx` | 本地增删问题和人群配置，并在客户端生成 ID | 配置草稿、版本保存和校验接口 |
| 历史记录 | `components/analytics-panel.tsx` | 调用内存 Mock 保存和读取完整记录 | 历史列表、历史详情和配置快照接口 |
| 统计与筛选 | `components/analytics-panel.tsx` | 浏览器重新计算、筛选和分组 | 服务端统计查询接口 |
| 问卷结果 | `components/bulk-survey-panel.tsx` | 展示浏览器内存中的回答和统计结果 | 消费回答及统计接口 |
| 访谈结果 | `components/chat-simulation-panel.tsx` | 展示浏览器内存中的会话，并直接引用 Mock 类型 | 依赖统一 API Contract 和访谈接口 |

现有 `app/api` 目录仅包含 `app/api/auth/login/route.ts`，该接口用于部署访问控制，不属于调研业务后端。

## 3. 迁移前调用链

当前一次模拟运行的主要调用链如下：

1. `SurveyConfigPanel` 在浏览器内修改 `SurveyConfig`。
2. `app/page.tsx` 中的 `runSimulation` 清空旧状态。
3. `apiGenerateRespondentsFromConfig` 调用 Mock 服务生成随机受访者。
4. 前端为每位受访者初始化 `InterviewSession`。
5. 前端逐受访者、逐问题调用 `askQuestion`。
6. Mock 服务随机生成回答、情绪、低质量标记和终止行为。
7. 前端调用 `shouldInterviewerTerminate` 判断是否终止。
8. 每次回答后，前端重新计算情绪、问题统计、人群统计和结构化回答。
9. 用户点击保存时，将配置、原始会话和前端计算结果整体写入模块内存。
10. 用户点击导出时，浏览器本地拼装 JSON 或 CSV 文件。

该链路意味着关闭或刷新页面会丢失当前运行和历史数据，任务也无法脱离浏览器后台执行。

## 4. 待迁移清单

### 4.1 P0：领域模型与持久化基础

- [ ] 建立项目、调研、配置版本、运行轮次、问题、样本方案、受访者、会话、消息、回答、统计快照和导出任务等实体。
- [ ] 为调研、轮次、问题、受访者、会话、消息和回答生成服务端稳定 ID。
- [ ] 禁止继续使用 `Date.now()`、数组序号或调研标题充当业务 ID。
- [ ] 每次运行绑定不可变配置快照，避免后续编辑污染历史结果。
- [ ] 为问卷模式与访谈模式定义明确的数据结构和状态迁移。
- [ ] 统一使用 ISO 8601 时间字符串作为接口传输格式。
- [ ] 定义分页结构、错误码、任务状态、终止原因和接口幂等规则。
- [ ] 将共享 TypeScript 类型从 `mock-survey-service.ts` 迁移到独立 API Contract。
- [ ] 引入数据库持久化原始回答、会话、运行状态和配置版本。

建议的核心关系：

```text
Project
└── Survey
    ├── ConfigVersion
    │   ├── Questions
    │   └── RespondentPlan
    └── Run
        ├── ConfigSnapshot
        ├── Respondents
        ├── QuestionnaireSessions / InterviewSessions
        │   ├── Answers
        │   └── Messages
        ├── Analytics
        └── ExportJobs
```

### 4.2 P0：调研配置与任务初始化

当前相关位置：

- `lib/mock-survey-service.ts` 中的 `defaultSurveyConfig`
- `lib/mock-survey-service.ts` 中的 `defaultRespondentConfigs`
- `components/survey-config-panel.tsx`
- `app/page.tsx` 中的 `runSimulation`

待迁移内容：

- [ ] 创建调研草稿。
- [ ] 查询调研配置。
- [ ] 保存标题、描述、运行模式、最大响应时间、问题和样本方案。
- [ ] 创建不可变配置版本。
- [ ] 根据指定配置版本初始化运行轮次。
- [ ] 将默认问卷改为后端模板，或明确保留为纯前端演示 Fixture。
- [ ] 服务端校验题目类型、选项、量表范围、问题 ID、样本数量和配额。
- [ ] JSON 编辑模式提交前执行结构校验，而不是只执行 `JSON.parse`。

建议接口：

```http
POST /api/projects
POST /api/projects/{projectId}/surveys
GET  /api/surveys/{surveyId}
PUT  /api/surveys/{surveyId}
POST /api/surveys/{surveyId}/versions
GET  /api/surveys/{surveyId}/versions
POST /api/surveys/{surveyId}/runs
GET  /api/templates
```

### 4.3 P0：受访者与样本方案

当前相关逻辑：

- `generateRespondentsFromConfig`
- 随机姓名、昵称、头像、年龄、教育、婚姻状态和标签池
- 根据职业、收入和年龄自动添加标签

待迁移内容：

- [ ] 根据样本方案生成或分配受访者。
- [ ] 支持真实受访者导入、外部样本源或 AI 虚拟受访者三种来源。
- [ ] 查询运行轮次的受访者列表。
- [ ] 查询单个受访者画像。
- [ ] 服务端校验基础配额和交叉配额。
- [ ] 定义画像字段、可选字段、自定义字段和字段类型。
- [ ] 明确个人信息、敏感信息、脱敏和数据保留规则。
- [ ] 将随机受访者生成逻辑移至后端模拟器，前端不再生成画像。

建议接口：

```http
POST /api/runs/{runId}/respondents/generate
POST /api/runs/{runId}/respondents/import
GET  /api/runs/{runId}/respondents
GET  /api/respondents/{respondentId}
```

### 4.4 P0：问卷填写

当前项目没有独立的真实问卷填写接口。问卷模式仍复用访谈式的逐问题 Mock 对话流程，再从对话消息中转换出 `SurveyResponse`。

待迁移内容：

- [ ] 创建问卷填写会话。
- [ ] 保存单题回答，支持覆盖和幂等提交。
- [ ] 批量保存回答。
- [ ] 提交整份问卷。
- [ ] 查询并恢复未完成问卷。
- [ ] 处理超时、主动终止、服务端终止和重复提交。
- [ ] 校验必填题、选项合法性、量表范围和回答类型。
- [ ] 严格保存文本、单选和量表题型，不能再将所有字符串回答归为 `choice`。
- [ ] 服务端记录开始时间、最后保存时间、提交时间和终止时间。

建议接口：

```http
POST /api/runs/{runId}/questionnaire-sessions
GET  /api/questionnaire-sessions/{sessionId}
PUT  /api/questionnaire-sessions/{sessionId}/answers/{questionId}
PUT  /api/questionnaire-sessions/{sessionId}/answers
POST /api/questionnaire-sessions/{sessionId}/submit
POST /api/questionnaire-sessions/{sessionId}/terminate
```

### 4.5 P0：访谈对话

当前相关逻辑：

- `askQuestion`
- `generatePersonalizedResponse`
- `shouldInterviewerTerminate`
- Mock 情绪分配、低质量回答概率和随机终止概率

待迁移内容：

- [ ] 创建访谈会话。
- [ ] 保存调研员消息和受访者消息。
- [ ] 查询完整对话历史。
- [ ] 生成下一问题或下一轮 AI 回复。
- [ ] 保存结构化回答与原始自然语言回答。
- [ ] 执行低质量回答检测。
- [ ] 执行受访者主动终止与调研方终止规则。
- [ ] 执行情绪分析，并保存分析版本和置信度。
- [ ] 保存模型名称、Prompt 版本、推理参数、Token 使用量、耗时和错误信息。
- [ ] 定义模型超时、重试、限流和降级策略。
- [ ] 支持人工访谈时仅保存消息、不调用 AI 的模式。

建议接口：

```http
POST /api/runs/{runId}/interview-sessions
GET  /api/interview-sessions/{sessionId}
GET  /api/interview-sessions/{sessionId}/messages
POST /api/interview-sessions/{sessionId}/messages
POST /api/interview-sessions/{sessionId}/next
POST /api/interview-sessions/{sessionId}/terminate
```

### 4.6 P0：后台任务与运行进度

当前任务循环完整位于 `app/page.tsx`。浏览器负责初始化 Session、逐题调用、更新进度和结束任务。

待迁移内容：

- [ ] 将运行编排迁移至后端任务服务或任务队列。
- [ ] 启动运行任务后立即返回 `runId` 和初始状态。
- [ ] 查询总样本数、已完成数、进行中数、终止数、失败数和当前阶段。
- [ ] 支持取消运行。
- [ ] 定义暂停、继续和失败样本重试是否纳入首期范围。
- [ ] 支持任务幂等启动，避免重复点击创建重复运行。
- [ ] 支持部分失败、服务重启恢复和断线重连。
- [ ] 使用 SSE、WebSocket 或轮询向前端同步运行状态。
- [ ] 前端移除逐受访者循环、逐问题循环、人工延时和本地任务状态机。

建议接口：

```http
POST /api/runs/{runId}/start
GET  /api/runs/{runId}
GET  /api/runs/{runId}/events
POST /api/runs/{runId}/cancel
POST /api/runs/{runId}/retry-failed
```

建议运行状态：

```text
draft
queued
running
partially_completed
completed
failed
cancelling
cancelled
```

### 4.7 P0：历史记录与回放

当前相关逻辑：

- `mockHistoryStorage`
- `saveSurveyToHistory`
- `fetchSurveyHistory`
- `fetchSurveyHistoryById`
- `AnalyticsPanel` 中的保存和历史弹窗

待迁移内容：

- [ ] 使用数据库替换模块内存数组。
- [ ] 历史列表分页，只返回运行摘要，不返回完整会话和所有统计。
- [ ] 历史详情按需查询配置快照、受访者、会话和统计。
- [ ] 支持根据状态、模式、创建时间和项目筛选历史。
- [ ] 支持复制历史配置为新轮次，不修改原始记录。
- [ ] 明确是否保留“保存本次调研”按钮；推荐运行过程自动持久化。
- [ ] 记录创建者、创建时间、开始时间、结束时间和配置版本。
- [ ] 处理记录不存在、版本不兼容和无权限访问。
- [ ] 前端历史列表不再直接持有完整 `SurveyHistoryRecord`。

建议接口：

```http
GET  /api/runs?page={page}&pageSize={pageSize}
GET  /api/runs/{runId}
GET  /api/runs/{runId}/sessions
POST /api/runs/{runId}/clone
```

### 4.8 P1：统计分析

当前相关逻辑：

- `analyzeSentiment`
- `analyzeQuestionResponses`
- `analyzeByDemographics`
- `getDimensionMetadata`
- `filterRespondentsByDimensions`
- `groupRespondentsByDimensions`
- `AnalyticsPanel` 中的客户端二次统计

待迁移内容：

- [ ] 返回运行概览：完成率、状态分布、消息数和终止原因。
- [ ] 返回情绪分布，并明确统计对象和计算口径。
- [ ] 返回每题有效回答数、回答分布和量表平均值。
- [ ] 返回人口维度分析。
- [ ] 支持 `questionId`、`filters` 和 `groupBy` 查询条件。
- [ ] 返回总体样本数、筛选样本数、有效回答数和缺失值数量。
- [ ] 明确终止样本、部分回答和失败样本是否纳入统计。
- [ ] 对小样本结果增加警告。
- [ ] 服务端根据原始回答生成统计，不能接受前端上传的统计结果作为可信数据。
- [ ] 为统计结果记录计算时间和算法版本。

建议接口：

```http
GET /api/runs/{runId}/analytics/summary
GET /api/runs/{runId}/analytics/questions
GET /api/runs/{runId}/analytics/demographics
```

查询示例：

```http
GET /api/runs/{runId}/analytics/questions
    ?questionId=q1
    &gender=男
    &city=北京
    &groupBy=income,occupation
```

### 4.9 P1：结果导出

当前 `exportSurveyResults` 在浏览器内拼装 JSON 或 CSV Blob。

待迁移内容：

- [ ] 创建服务端导出任务。
- [ ] 查询导出任务状态。
- [ ] 下载生成后的文件。
- [ ] 支持 JSON、CSV，并明确是否需要 XLSX。
- [ ] 支持导出范围、筛选条件和字段选择。
- [ ] 记录文件名、创建者、创建时间、格式、范围、状态和错误信息。
- [ ] 正确处理 CSV 引号、逗号、换行、编码和公式注入风险。
- [ ] 大数据量使用流式生成或异步任务。
- [ ] 定义导出文件保存期限和访问权限。

建议接口：

```http
POST /api/runs/{runId}/exports
GET  /api/exports/{exportId}
GET  /api/exports/{exportId}/download
```

## 5. 前端 API 层改造

`lib/survey-api.ts` 应从 Mock 转发层改为真实 API Client。

待办：

- [ ] 删除 `export * from "./mock-survey-service"`。
- [ ] 所有组件统一从 API Contract 引用类型。
- [ ] 修复 `ChatSimulationPanel` 直接引用 Mock 服务的问题。
- [ ] 为每个请求统一处理 Base URL、认证信息、超时、错误结构和取消信号。
- [ ] 为列表接口增加分页类型。
- [ ] 为后台任务增加轮询或事件订阅封装。
- [ ] 前端只保存当前页面所需的缓存和 UI 状态。
- [ ] UI 状态继续留在前端，例如当前工作区、弹窗开关、选中问题和图表折叠状态。

## 6. 数据迁移与兼容性问题

### 6.1 ID 使用不稳定

当前问题：

- 问题 ID 使用 `q${length + 1}`，删除后新增可能重复。
- 受访者配置 ID 使用 `Date.now()`。
- 消息 ID 和历史记录 ID 使用时间戳与随机数。
- `apiBuildSurveyResponses` 调用时使用调研标题作为 `surveyId`。

处理要求：

- [ ] 所有持久化实体使用服务端稳定 ID。
- [ ] 标题只作为展示字段，不作为关联键。

### 6.2 时间类型不一致

历史保存使用 JSON 深拷贝，会将 `Date` 转换为字符串，但类型仍声明为 `Date`。

处理要求：

- [ ] Contract 中明确时间字段为 ISO 字符串。
- [ ] 前端仅在展示时转换为 `Date`。

### 6.3 回答类型丢失

`buildSurveyResponses` 将所有字符串回答统一归类为 `choice`，开放文本题会失去类型信息。

处理要求：

- [ ] 回答记录必须关联问题及题型。
- [ ] 服务端根据问题定义验证并保存 `text`、`choice` 或 `scale`。

### 6.4 问卷与访谈模式未真正分离

当前两种模式只影响结果面板展示，实际运行逻辑完全相同。

处理要求：

- [ ] 问卷模式使用结构化回答提交模型。
- [ ] 访谈模式使用消息和轮次模型。
- [ ] 两种模式共享调研、配置版本、运行轮次和统计基础实体。

### 6.5 历史列表载荷过大

当前历史列表直接返回完整配置、会话、受访者和分析数据，详情接口虽然存在但未被使用。

处理要求：

- [ ] 列表接口只返回摘要。
- [ ] 点击记录后再查询详情、会话或统计。

### 6.6 前端派生结果不能作为可信数据

当前保存历史时，前端会同时上传原始会话和已计算的统计结果。

处理要求：

- [ ] 后端只信任原始配置、回答、消息和状态变化。
- [ ] 情绪、问题分析和人口分析由服务端计算或校验。

## 7. 建议实施顺序

1. 定义领域模型、API Contract、状态机和数据库结构。
2. 实现调研草稿、配置版本和运行轮次接口。
3. 实现问卷填写与访谈消息写入。
4. 将运行编排迁移至后端任务服务。
5. 实现运行进度、取消、重试和事件同步。
6. 实现历史列表、详情和配置快照回放。
7. 将统计分析迁移至服务端。
8. 将导出迁移至服务端。
9. 修改 `lib/survey-api.ts` 和各前端组件，移除 Mock 依赖。
10. 删除生产路径中的 `mock-survey-service.ts`，将必要样例迁移到测试 Fixture。

## 8. 分阶段完成标准

### 阶段一：可持久化

- [ ] 刷新页面后，调研草稿和历史运行仍然存在。
- [ ] 每次运行绑定明确的配置版本。
- [ ] 修改当前配置不会影响历史配置快照。
- [ ] 前端不再使用 `mockHistoryStorage`。

### 阶段二：可后台运行

- [ ] 运行任务由后端创建和执行。
- [ ] 关闭页面后任务可以继续运行。
- [ ] 重新打开页面能够恢复当前进度。
- [ ] 重复启动、失败、取消和断线均有明确状态。

### 阶段三：真实填写与访谈

- [ ] 问卷回答通过结构化接口写入。
- [ ] 访谈消息通过会话接口写入。
- [ ] 回答类型、终止状态和时间字段准确保存。
- [ ] AI 调用可追溯到模型和 Prompt 版本。

### 阶段四：可信分析与导出

- [ ] 统计由服务端原始数据生成。
- [ ] 总体、筛选和分组口径清晰。
- [ ] 历史统计可复现。
- [ ] 导出任务有状态、权限和审计记录。

## 9. 最终清理清单

- [ ] `lib/survey-api.ts` 不再导出 Mock 服务。
- [ ] `app/page.tsx` 不再负责业务任务编排。
- [ ] `components/analytics-panel.tsx` 不再计算可信统计或保存完整历史。
- [ ] `components/chat-simulation-panel.tsx` 不再直接依赖 Mock 类型。
- [ ] `components/survey-config-panel.tsx` 不再生成持久化业务 ID。
- [ ] 生产代码不再使用随机回答、随机情绪和随机终止逻辑。
- [ ] 浏览器内存只保留界面状态和可丢弃缓存。
- [ ] Mock 数据仅存在于单元测试、Storybook 或本地演示 Fixture。
- [ ] 所有后端接口具备认证、权限、参数校验、日志和自动化测试。
- [ ] README 与 `docs/PROJECT_ITERATION.md` 更新为真实后端状态。
