# Project Iteration Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 README 摘要与 `docs/PROJECT_ITERATION.md` 完整台账组成的可持续项目迭代文档体系。

**Architecture:** `README.md` 作为项目入口，只呈现当前阶段、能力边界、最高优先级和台账链接；`docs/PROJECT_ITERATION.md` 作为唯一完整事实源，维护问题池、路线图、当前焦点、验收标准和逐轮记录。现有体验与布局评估文档作为证据来源保留。

**Tech Stack:** Markdown、Git、Next.js 项目构建校验、应用内浏览器实测结果

---

### Task 1: 建立完整项目迭代台账

**Files:**
- Create: `docs/PROJECT_ITERATION.md`
- Reference: `docs/AI问卷调研系统用户体验评价与迭代建议.md`
- Reference: `LAYOUT_EVALUATION_REPORT.md`
- Reference: `app/page.tsx`
- Reference: `lib/mock-survey-service.ts`

- [x] **Step 1: 写入台账固定结构**

创建文件并按顺序写入以下一级章节：

```markdown
# Survey Agent Simulator 项目迭代文档

## 文档定位与维护规则
## 当前项目现状
## 当前能力边界
## 问题与优先级
## 当前最迫切的迭代模块
## 分阶段路线图
## 统一验收原则
## 迭代记录
## 迭代记录模板
## 参考资料
```

维护规则必须明确：每次功能、修复或架构迭代都在同一变更中更新台账；项目定位、核心能力、架构、运行命令或最高优先级变化时同步更新 README；规划能力不得写成现状。

- [x] **Step 2: 记录可验证的当前现状与边界**

现状必须覆盖：问卷/访谈双模式、表单/JSON 配置、顺序 mock 模拟、实时进度、个体与聚合结果、维度筛选/group by、内存历史记录、JSON/CSV 浏览器下载、Next.js 16.1.6 与 React 19.2.4。

边界必须明确：没有真实 AI/后端持久化、没有项目—轮次—版本模型、没有暂停/继续/失败重试、固定受访者字段、没有运行前研究设计检查、多栏布局未响应式降级、保存和导出反馈不足。

- [x] **Step 3: 写入问题池与路线图**

使用 P0/P1/P2 表格，每项包含模块、现状、目标和完成标准。排序固定为：

1. P0-A 响应式布局与滚动模型；
2. P0-B 研究轮次、配置快照与保存/导出可信度；
3. P0-C 分析口径与异常解释；
4. P1 样本方案、研究设计检查与证据链；
5. P2 多轮对比、协作、模板和性能。

- [x] **Step 4: 展开当前最迫切模块**

把响应式布局与滚动模型写成下一轮可执行范围，覆盖 `<768 px` 单栏导航、`768–1199 px` 中心工作区加抽屉、`>=1200 px` 桌面工作台、统一滚动容器、sticky 主操作、长文本与最小宽度保护。

验收必须包含 390/768/1024/1280/1440 px 无非预期横向滚动，以及 390 px 可完成配置、启动、查看结果和查看分析。

- [x] **Step 5: 建立首条迭代记录与模板**

首条记录日期使用 `2026-06-21`，类型为“文档治理”，记录本次建立台账、基线实测数据、未修改产品代码和下一步进入响应式布局改造。模板字段必须包括日期、版本/提交、目标、完成内容、验证、遗留问题和下一步。

- [x] **Step 6: 检查台账结构**

Run:

```bash
rg -n '^## (文档定位与维护规则|当前项目现状|当前能力边界|问题与优先级|当前最迫切的迭代模块|分阶段路线图|统一验收原则|迭代记录|迭代记录模板|参考资料)$' docs/PROJECT_ITERATION.md
```

Expected: 输出 10 个匹配章节，顺序与固定结构一致。

### Task 2: 更新 README 的项目入口与路线图摘要

**Files:**
- Modify: `README.md`
- Reference: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: 修正项目阶段与能力边界**

在项目简介后增加“当前阶段”章节，明确项目是使用 mock 服务和前端内存状态的可交互原型，适合流程演示、探索和界面验证，不代表真实 AI 调研后端或可复现研究基础设施已完成。

- [x] **Step 2: 增加当前迭代重点**

写入三项摘要：响应式布局与滚动模型、研究轮次与持久化、分析口径与异常解释。第一项标记为“下一轮实施目标”，并链接 `docs/PROJECT_ITERATION.md` 获取完整范围与验收标准。

- [x] **Step 3: 增加文档维护约定**

明确每次项目迭代必须同步更新 `docs/PROJECT_ITERATION.md`；当定位、能力、架构、运行方式或最高优先级变化时同步更新 README；评估报告只作历史依据。

- [x] **Step 4: 修正运行命令表达**

保留 npm 作为锁文件对应的默认命令，把 pnpm/yarn 说明改为“如团队选择对应包管理器，应使用并维护唯一锁文件”，避免三个包管理器看起来具有同等基准地位。

- [x] **Step 5: 验证 README 与台账链接及关键信息**

Run:

```bash
rg -n '当前阶段|当前迭代重点|PROJECT_ITERATION.md|每次项目迭代|mock|响应式布局' README.md docs/PROJECT_ITERATION.md
```

Expected: 两份文档均出现一致的当前阶段、最高优先级和维护规则，README 包含有效的相对链接。

### Task 3: 最终一致性与项目验证

**Files:**
- Verify: `README.md`
- Verify: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: 扫描不完整内容**

Run:

```bash
rg -n 'TBD|TODO|待补充|占位符' README.md docs/PROJECT_ITERATION.md
```

Expected: 无输出。

- [x] **Step 2: 检查 Markdown 标题与工作区差异**

Run:

```bash
rg -n '^#{1,6} ' README.md docs/PROJECT_ITERATION.md
git diff --check
git diff -- README.md docs/PROJECT_ITERATION.md
```

Expected: 标题层级连续；`git diff --check` 无输出；差异仅包含计划中的文档变更。

- [x] **Step 3: 构建项目**

Run:

```bash
npm run build
```

Expected: Next.js production build 成功，无 TypeScript 或构建错误。

- [x] **Step 4: 提交文档变更**

Run:

```bash
git add README.md docs/PROJECT_ITERATION.md docs/superpowers/plans/2026-06-21-project-iteration-docs.md
git commit -m "docs: establish project iteration roadmap"
```

Expected: 提交仅包含 README、项目迭代台账和实施计划，不包含 `.idea/` 或其他用户文件。
