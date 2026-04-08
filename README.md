# v0-project-survey

一个面向产品与研究团队的 AI 模拟调研平台，用于在真正后端上线之前快速探索访谈话术、应答逻辑、情绪趋势与人群分布。每次提交会触发 v0 部署，因此在本地调试即是 Live Preview。

## 业务逻辑
- **配置驱动的模拟**：通过左侧配置面板调整问卷名称、描述、响应预算和问题库（文本/选择/量表），还可以定义性别、年龄段、职业、城市、收入及人数等受访者片段。配置支持切换到 JSON 编辑模式，便于导入导出整套设定。
- **AI 访谈模拟**：`app/page.tsx` 负责重置状态、调用 `apiGenerateRespondentsFromConfig`（通过 `lib/mock-survey-service.ts` 的 mock 实现）生成受访者群，再依序调用 `askQuestion`、`shouldInterviewerTerminate` 等函数模拟问答过程。每位受访者的对话、情绪、完成状态与终止原因都会被记录。
- **多维分析与导出**：分析面板实时汇总进度、情绪饼图、问题答复分布、受访者画像和维度聚合。问题分析支持按照性别/年龄/职业/城市/收入等维度筛选组合（例如“性别 = 男、收入 20-30 万、城市 = 北京”），也支持多维 group by（如同时分组性别 + 收入 + 城市）。历史记录可以保存、回放，数据可导出为 JSON/CSV 供进一步分析。

## 架构概览
- **Next.js App Router + 统一布局**：`app/layout.tsx` 加载字体与全局样式（`app/globals.css`），`components/theme-provider.tsx` 强制暗黑主题，整体采用三栏布局（配置/模拟/分析）并通过 `app/page.tsx` 编排。
- **`app/page.tsx`：前端大脑**：此 client 组件持有大量状态（session、respondents、analytics、mode 选择、历史记录等），对外暴露 `runSimulation`、`handleExport`、`handleLoadHistory`、`handleModeSelection` 等回调，并根据模式渲染 chat 或 bulk 面板。
- **数据层与服务封装**：`lib/survey-api.ts` 仅暴露 API 接口；真实逻辑在 `lib/mock-survey-service.ts` 中，包括 respondent 生成、对话扇区、分析函数（`analyzeQuestionResponses`、`analyzeByDemographics`、`filterRespondentsByDimensions`、`groupRespondentsByDimensions`）及历史存储/导出工具。`lib/utils.ts` 提供类名拼接等通用辅助。

## 核心组件
- **`SurveyConfigPanel`（左侧）**：管理元数据、响应时间滑块、可折叠问题列表及其选项、受访者片段（性别/年龄/职业/城市/收入/人数），统计结果实时呈现，运行按钮会在配置不完整或正在模拟时禁用。
- **`ChatSimulationPanel` 与 `BulkSurveyPanel`（中间）**：前者展示逐条访谈对话、受访者侧边栏、状态气泡；后者以卡片和图表形式展示批量完成情况、问题指标、问卷细节。
- **`AnalyticsPanel`（右侧）**：分为概览、问题分析、画像三页，包含快速统计卡片、完成率进度条、情绪饼图、问题答题分布、维度筛选与分组、城市/收入画像、导出/保存/历史按钮。问题分析对任何选择问题都自动读取维度，并允许多维过滤、任意组合的 group by 分析。
- **共享 UI**：`components/ui`（由 ShadCN 生成）提供按钮、徽章、选择框、标签页、滑块、对话框、表格、图表容器等原语，图表部分基于 Recharts，对轴标签与提示信息进行了本地化。

## 交互流程
1. **选择模式**：进入页面后先选择“访谈”或“问卷”模式，确保中间面板呈现对应视图。
2. **编辑配置**：在左侧输入调研标题/描述、设置响应时长、添加问题（文本/选择/量表），并指定受访者片段（性别、年龄段、职业、城市、收入与人数），可切换 JSON 模式快速批量编辑。
3. **执行模拟**：点击“运行模拟”后清空旧数据、生成 respondents、按问题逐个调用 `askQuestion`，每次交互会触发分析更新并同步进度。
4. **检视分析**：右侧分析面板实时更新：概览卡片、情绪/状态图、问题答复分布（支持多维筛选、group by、提示轴标签）、城市/收入画像、导出/保存/历史等操作。
5. **沉淀与复用**：成功模拟后可保存历史记录，稍后通过历史列表回放；也可导出 JSON/CSV，在其他平台继续分析或归档。

## 运行方式
```bash
npm install
npm run dev
```
或使用 pnpm/yarn：  
```bash
pnpm install
pnpm dev
```
```bash
yarn install
yarn dev
```
浏览器访问 [http://localhost:3000](http://localhost:3000) 即可本地体验。

## 构建于 v0
本仓库已连接至 [v0](https://v0.app) 项目，推送至 `main` 会自动触发部署。
