# P0-A Responsive Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 P0-A 响应式布局与滚动模型，使问卷和访谈在五个目标视口下无横向溢出，并在移动端提供可完成核心流程的顶部工作区导航。

**Architecture:** 将断点判断抽成可测试的纯函数，并由响应式 hook 向页面返回 mobile/tablet/desktop 布局模式。`app/page.tsx` 负责移动 Tabs、平板 Sheet 和桌面三栏三种承载结构；各业务面板只补充尺寸、滚动与窄屏内容约束，不改变模拟或分析数据流。

**Tech Stack:** Next.js 16、React 19、TypeScript、Tailwind CSS 4、Radix Tabs/Sheet、Node.js test runner、应用内 Browser

---

### Task 1: 建立可测试的响应式断点模型

**Files:**
- Create: `lib/responsive-layout.mjs`
- Create: `tests/responsive-layout.test.mjs`
- Modify: `hooks/use-mobile.ts`

- [x] **Step 1: 写入失败的断点测试**

创建 `tests/responsive-layout.test.mjs`：

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  MOBILE_BREAKPOINT,
  DESKTOP_BREAKPOINT,
  getResponsiveLayout,
} from "../lib/responsive-layout.mjs"

test("uses mobile layout below 768px", () => {
  assert.equal(MOBILE_BREAKPOINT, 768)
  assert.equal(getResponsiveLayout(390), "mobile")
  assert.equal(getResponsiveLayout(767), "mobile")
})

test("uses tablet layout from 768px through 1199px", () => {
  assert.equal(getResponsiveLayout(768), "tablet")
  assert.equal(getResponsiveLayout(1024), "tablet")
  assert.equal(getResponsiveLayout(1199), "tablet")
})

test("uses desktop layout from 1200px", () => {
  assert.equal(DESKTOP_BREAKPOINT, 1200)
  assert.equal(getResponsiveLayout(1200), "desktop")
  assert.equal(getResponsiveLayout(1440), "desktop")
})
```

- [x] **Step 2: 运行测试并确认红灯**

Run:

```bash
node --test tests/responsive-layout.test.mjs
```

Expected: FAIL，提示找不到 `lib/responsive-layout.mjs`。

- [x] **Step 3: 实现最小断点函数**

创建 `lib/responsive-layout.mjs`：

```js
export const MOBILE_BREAKPOINT = 768
export const DESKTOP_BREAKPOINT = 1200

/**
 * @param {number} width
 * @returns {"mobile" | "tablet" | "desktop"}
 */
export function getResponsiveLayout(width) {
  if (width < MOBILE_BREAKPOINT) return "mobile"
  if (width < DESKTOP_BREAKPOINT) return "tablet"
  return "desktop"
}
```

- [x] **Step 4: 运行测试并确认绿灯**

Run:

```bash
node --test tests/responsive-layout.test.mjs
```

Expected: 3 tests passed，0 failed。

- [x] **Step 5: 扩展响应式 hook**

保留 `useIsMobile` 的现有导出，新增：

```ts
import {
  MOBILE_BREAKPOINT,
  DESKTOP_BREAKPOINT,
  getResponsiveLayout,
} from "@/lib/responsive-layout.mjs"

export type ResponsiveLayout = "mobile" | "tablet" | "desktop"

export function useResponsiveLayout(): ResponsiveLayout {
  const [layout, setLayout] = React.useState<ResponsiveLayout>("desktop")

  React.useEffect(() => {
    const updateLayout = () => setLayout(getResponsiveLayout(window.innerWidth))
    const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const desktopQuery = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`)

    mobileQuery.addEventListener("change", updateLayout)
    desktopQuery.addEventListener("change", updateLayout)
    updateLayout()

    return () => {
      mobileQuery.removeEventListener("change", updateLayout)
      desktopQuery.removeEventListener("change", updateLayout)
    }
  }, [])

  return layout
}
```

同时让 `useIsMobile()` 基于 `useResponsiveLayout()` 返回 `layout === "mobile"`，避免两套断点逻辑。

- [x] **Step 6: 验证类型**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0。

- [x] **Step 7: 提交断点模型**

```bash
git add lib/responsive-layout.mjs tests/responsive-layout.test.mjs hooks/use-mobile.ts
git commit -m "test: define responsive workspace breakpoints"
```

### Task 2: 重构页面骨架和三种工作区承载方式

**Files:**
- Modify: `app/page.tsx`
- Reference: `components/ui/sheet.tsx`
- Reference: `components/ui/tabs.tsx`

- [x] **Step 1: 记录页面验收红灯**

使用 Browser 在问卷模式测量当前页面：

```js
({
  viewportWidth: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  documentHeight: document.documentElement.scrollHeight,
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
  overflowY: document.documentElement.scrollHeight - window.innerHeight,
})
```

Expected baseline:

- 390 px：`overflowX = 491`
- 768 px：`overflowX = 113`
- 1024/1280/1440 px：`overflowX = 0`，但 `overflowY = 539`

- [x] **Step 2: 增加工作区类型和状态**

在 `app/page.tsx` 中新增导入：

```tsx
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useResponsiveLayout } from "@/hooks/use-mobile"
import {
  BarChart3,
  ClipboardList,
  MessageSquare,
  PanelLeftOpen,
  PanelRightOpen,
  Settings2,
  Sparkles,
  Cpu,
} from "lucide-react"
```

新增类型和状态：

```tsx
type Workspace = "config" | "results" | "analytics"

const layout = useResponsiveLayout()
const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("config")
const [configSheetOpen, setConfigSheetOpen] = useState(false)
const [analyticsSheetOpen, setAnalyticsSheetOpen] = useState(false)
```

- [x] **Step 3: 抽取三块面板视图**

在 `return` 前定义 `configPanel`、`resultsPanel`、`analyticsPanel` 三个 JSX 变量，内容分别复用现有 `SurveyConfigPanel`、问卷/访谈结果组件和 `AnalyticsPanel` 的完整 props。每个变量外层不增加固定宽度。

```tsx
const configPanel = (
  <SurveyConfigPanel
    config={config}
    onConfigChange={setConfig}
    onStartSimulation={runSimulation}
    isRunning={isRunning}
    mode={mode}
  />
)

const resultsPanel =
  mode === "interview" ? (
    <ChatSimulationPanel
      sessions={displaySessions}
      respondents={displayRespondents}
      isRunning={isRunning}
      currentRespondentId={activeRespondentId}
      onSelectRespondent={handleSelectRespondent}
    />
  ) : (
    <BulkSurveyPanel
      sessions={displaySessions}
      respondents={displayRespondents}
      progress={displayProgress}
      questions={displayQuestions}
      questionAnalysis={displayQuestionAnalysis}
      responses={displayResponses}
      isRunning={isRunning && !viewingHistoryRecord}
    />
  )
```

`analyticsPanel` 使用现有完整 props，不改变回调。

- [x] **Step 4: 让运行后切到结果**

在 `runSimulation` 通过 `isRunning` 守卫后立即调用：

```tsx
setActiveWorkspace("results")
setConfigSheetOpen(false)
```

其余模拟逻辑保持原样。

- [x] **Step 5: 重建页面根骨架和 Header**

根节点改为：

```tsx
<div className="h-dvh min-h-0 min-w-0 overflow-hidden bg-background flex flex-col">
```

Header 改为 `shrink-0`，内部使用：

```tsx
<div className="px-3 py-3 sm:px-4 xl:px-6 xl:py-4">
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
```

品牌区域增加 `min-w-0`；标题允许换行，副标题在 390 px 可隐藏；模式按钮容器使用 `self-stretch md:self-auto`，两个按钮使用 `flex-1 md:flex-none`；状态徽章使用 `shrink-0`。

- [x] **Step 6: 实现移动顶部 Tabs**

当 `layout === "mobile"` 时，在 Header 下渲染：

```tsx
<nav
  aria-label="工作区导航"
  className="grid grid-cols-3 border-t border-border/50 bg-background/90 p-1"
>
  {[
    { value: "config", label: "配置", icon: Settings2 },
    {
      value: "results",
      label: mode === "interview" ? "访谈" : "结果",
      icon: mode === "interview" ? MessageSquare : ClipboardList,
    },
    { value: "analytics", label: "分析", icon: BarChart3 },
  ].map(item => (
    <button
      key={item.value}
      type="button"
      aria-pressed={activeWorkspace === item.value}
      onClick={() => setActiveWorkspace(item.value as Workspace)}
      className={activeWorkspace === item.value
        ? "flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary/15 text-xs font-medium text-primary"
        : "flex h-9 items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground"}
    >
      <item.icon className="size-4" />
      {item.label}
    </button>
  ))}
</nav>
```

- [x] **Step 7: 实现三种 Main 布局**

Main 共用：

```tsx
<main className="relative z-10 flex-1 min-h-0 min-w-0 overflow-hidden">
```

移动端只渲染当前工作区：

```tsx
<section className="h-full min-h-0 min-w-0 overflow-hidden">
  {activeWorkspace === "config" && configPanel}
  {activeWorkspace === "results" && resultsPanel}
  {activeWorkspace === "analytics" && analyticsPanel}
</section>
```

平板端渲染结果和工具按钮，并使用两个受控 Sheet：

```tsx
<div className="relative h-full min-h-0 min-w-0 overflow-hidden">
  <div className="absolute top-3 left-3 right-3 z-20 flex justify-between pointer-events-none">
    <Button className="pointer-events-auto" onClick={() => setConfigSheetOpen(true)}>
      <PanelLeftOpen />配置
    </Button>
    <Button className="pointer-events-auto" onClick={() => setAnalyticsSheetOpen(true)}>
      分析<PanelRightOpen />
    </Button>
  </div>
  <div className="h-full min-h-0 min-w-0 overflow-hidden">{resultsPanel}</div>
</div>
```

Sheet 内容使用：

```tsx
<SheetContent side="left" className="w-[min(92vw,420px)] max-w-none gap-0 p-0">
  <SheetHeader className="sr-only">
    <SheetTitle>调研配置</SheetTitle>
    <SheetDescription>编辑调研问题和受访者配置</SheetDescription>
  </SheetHeader>
  <div className="flex-1 min-h-0 overflow-hidden">{configPanel}</div>
</SheetContent>
```

分析 Sheet 对称地从右侧打开。

桌面端使用：

```tsx
<div className="flex h-full min-h-0 min-w-0 overflow-hidden">
  <aside className="w-[340px] min-h-0 min-w-0 shrink-0 overflow-hidden border-r ...">
    {configPanel}
  </aside>
  <section className="flex-1 min-h-0 min-w-0 overflow-hidden ...">
    {resultsPanel}
  </section>
  <aside className="w-[340px] min-h-0 min-w-0 shrink-0 overflow-hidden border-l ...">
    {analyticsPanel}
  </aside>
</div>
```

- [x] **Step 8: 修正模式选择弹窗**

遮罩增加 `p-4`，内容宽度改为：

```tsx
className="w-full max-w-[380px] rounded-2xl border ... p-5 sm:p-6"
```

- [x] **Step 9: 验证类型并提交**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0。

Commit:

```bash
git add app/page.tsx
git commit -m "feat: add responsive survey workspace shell"
```

### Task 3: 统一配置、问卷和分析面板的滚动约束

**Files:**
- Modify: `components/survey-config-panel.tsx`
- Modify: `components/bulk-survey-panel.tsx`
- Modify: `components/analytics-panel.tsx`

- [x] **Step 1: 修正配置面板约束**

将配置根节点改为：

```tsx
<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
```

Header 增加 `shrink-0 min-w-0`；标题容器增加 `min-w-0`；`ScrollArea` 使用 `className="min-h-0 flex-1 p-3 sm:p-4"`；底部运行区增加 `shrink-0 bg-card/95 backdrop-blur`。

问题标题从固定 `max-w-[180px]` 改为：

```tsx
<span className="min-w-0 flex-1 truncate text-sm text-foreground">
```

受访者输入网格从：

```tsx
className="grid grid-cols-2 gap-2"
```

改为：

```tsx
className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2"
```

- [x] **Step 2: 修正问卷面板约束**

根节点改为 `h-full min-h-0 min-w-0 overflow-hidden flex flex-col`；Header 改为 `shrink-0 flex-wrap gap-2 px-3 py-3 sm:px-6 sm:py-4`；内容区使用 `min-h-0 min-w-0 overflow-hidden p-3 sm:p-4`。

顶部统计卡改为：

```tsx
<div className="grid shrink-0 grid-cols-1 gap-2 min-[480px]:grid-cols-3 sm:gap-3">
```

问题标题与徽章容器增加 `min-w-0 gap-2`，标题增加 `break-words`，避免回答数量徽章被推出视口。

- [x] **Step 3: 修正分析面板约束**

根节点改为 `flex h-full min-h-0 min-w-0 flex-col overflow-hidden`；Header 使用 `shrink-0` 并允许动作换行；`ScrollArea` 使用 `min-h-0 flex-1 p-3 sm:p-4`；统计卡与 Tabs 保持 340 px 侧栏可读，并保证 Sheet 内宽度不产生固定最小宽度。

- [x] **Step 4: 验证并提交**

Run:

```bash
npx tsc --noEmit
node --test tests/responsive-layout.test.mjs
```

Expected: 类型检查通过；3 tests passed。

Commit:

```bash
git add components/survey-config-panel.tsx components/bulk-survey-panel.tsx components/analytics-panel.tsx
git commit -m "fix: contain workspace panel scrolling"
```

### Task 4: 为访谈模式增加移动端名单/对话切换

**Files:**
- Modify: `components/chat-simulation-panel.tsx`

- [x] **Step 1: 写下访谈移动验收红灯**

在 390 px 问卷/访谈模式切换后测量受访者列表宽度。Expected baseline: 列表固定 256 px，并与对话并排，导致对话区不可读。

- [x] **Step 2: 新增局部视图状态**

新增：

```tsx
type MobileInterviewView = "respondents" | "conversation"
const [mobileView, setMobileView] = useState<MobileInterviewView>("respondents")
```

选择受访者时切换：

```tsx
const handleSelectRespondent = (id: string) => {
  setSelectedRespondentId(id)
  setMobileView("conversation")
  onSelectRespondent(id)
}
```

- [x] **Step 3: 增加移动端局部导航**

根节点改为 `flex h-full min-h-0 min-w-0 flex-col overflow-hidden md:flex-row`。在内容顶部增加仅移动可见的两按钮导航，按钮分别设置 `aria-pressed`，文本为“受访者”和“对话”。

受访者列表类名：

```tsx
className={cn(
  "min-h-0 min-w-0 flex-col border-border/30 md:flex md:w-64 md:shrink-0 md:border-r",
  mobileView === "respondents" ? "flex flex-1" : "hidden",
)}
```

对话区类名：

```tsx
className={cn(
  "min-h-0 min-w-0 flex-1 flex-col",
  mobileView === "conversation" ? "flex" : "hidden md:flex",
)}
```

对话气泡增加 `break-words [overflow-wrap:anywhere]`。

- [x] **Step 4: 验证并提交**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0。

Commit:

```bash
git add components/chat-simulation-panel.tsx
git commit -m "feat: add mobile interview navigation"
```

### Task 5: 浏览器回归和工程验证

**Files:**
- Verify: `app/page.tsx`
- Verify: `components/survey-config-panel.tsx`
- Verify: `components/bulk-survey-panel.tsx`
- Verify: `components/chat-simulation-panel.tsx`
- Verify: `components/analytics-panel.tsx`

- [x] **Step 1: 运行自动化检查**

Run:

```bash
node --test tests/responsive-layout.test.mjs
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected:

- Node tests: 3 passed；
- TypeScript: exit 0；
- lint: exit 0；若项目既有 lint 脚本因缺少 ESLint 依赖失败，记录为既有工程问题，不以静默跳过代替；
- build: exit 0；
- diff check: 无输出。

- [x] **Step 2: 验证问卷模式五个视口**

在 Browser 中逐个设置 390 × 844、768 × 720、1024 × 720、1280 × 720、1440 × 720，记录：

```js
({
  documentWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  documentHeight: document.documentElement.scrollHeight,
  viewportHeight: window.innerHeight,
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
  overflowY: document.documentElement.scrollHeight - window.innerHeight,
})
```

Expected: 五个视口 `overflowX === 0` 且页面根 `overflowY === 0`。

- [x] **Step 3: 验证移动与平板交互**

390 px：

1. 打开“配置”“结果”“分析”顶部 Tabs；
2. 确认每个按钮唯一可达且 `aria-pressed` 正确；
3. 点击“开始问卷模拟”，确认自动进入结果；
4. 切换到分析，确认分析面板可滚动。

768/1024 px：

1. 打开配置 Sheet 并关闭；
2. 打开分析 Sheet 并关闭；
3. 确认结果区始终保持全宽且业务状态未重置。

- [x] **Step 4: 验证访谈模式**

390 px：

1. 切换访谈模式；
2. 确认工作区顶部 Tabs 文案为“配置 / 访谈 / 分析”；
3. 在访谈工作区切换“受访者 / 对话”；
4. 选择受访者后自动进入对话。

1280/1440 px：确认受访者列表与对话并排，三栏独立滚动。

- [x] **Step 5: 检查控制台**

Run Browser console log query with levels `error` and `warning`。

Expected: 无新增 error；既有 Next.js/Babel 警告单独记录。

### Task 6: 同步 README 和项目迭代台账

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT_ITERATION.md`

- [x] **Step 1: 更新 README**

将架构描述更新为三段式响应式工作区：

- `<768 px` 顶部工作区 Tabs；
- `768–1199 px` 结果中心 + 配置/分析 Sheet；
- `>=1200 px` 三栏工作台。

在当前迭代重点中把 P0-A 标记为已完成，并把“研究轮次、配置快照与持久化”标记为下一轮目标。

- [x] **Step 2: 更新迭代台账**

更新日期为 2026-06-27；当前焦点改为 P0-B；在已实现能力加入响应式工作区；从能力边界中移除“多栏布局没有响应式降级”；将 P0-A 状态改为“已完成（2026-06-27）”。

在迭代记录顶部新增：

```markdown
### 2026-06-27：完成 P0-A 响应式布局与滚动模型

- **类型**：功能 / 修复
- **目标**：消除五个目标视口的非预期横向滚动，并让移动端完成配置、运行、结果和分析流程。
- **完成内容**：记录实际落地的移动 Tabs、平板 Sheet、桌面三栏、统一滚动和访谈局部导航。
- **验证**：填写五个视口最终测量、问卷/访谈交互、Node tests、TypeScript、lint、build 和控制台结果。
- **遗留问题**：只记录真实未解决项。
- **下一步**：进入 P0-B 研究轮次、配置快照与保存/导出可信度。
```

- [x] **Step 3: 最终文档和差异检查**

Run:

```bash
rg -n 'P0-A|P0-B|响应式|2026-06-27' README.md docs/PROJECT_ITERATION.md
git diff --check
```

Expected: 两份文档状态一致；diff check 无输出。

- [x] **Step 4: 提交文档和最终修正**

```bash
git add README.md docs/PROJECT_ITERATION.md docs/superpowers/plans/2026-06-27-responsive-workspace.md
git commit -m "docs: record P0-A responsive workspace completion"
```
