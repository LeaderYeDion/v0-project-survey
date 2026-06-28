"use client"

import { useState, useCallback, useRef } from "react"
import { SurveyConfigPanel } from "@/components/survey-config-panel"
import { ChatSimulationPanel } from "@/components/chat-simulation-panel"
import { AnalyticsPanel } from "@/components/analytics-panel"
import { BulkSurveyPanel } from "@/components/bulk-survey-panel"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
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
  Cpu,
  MessageSquare,
  PanelLeftOpen,
  PanelRightOpen,
  Settings2,
  Sparkles,
} from "lucide-react"
import {
  defaultSurveyConfig,
  type SurveyConfig,
  type InterviewSession,
  type RespondentProfile,
  type SurveyProgress,
  type SentimentData,
  type DialogMessage,
  type QuestionAnalysis,
  type DemographicAnalysis,
  type SurveyHistoryRecord,
  analyzeSentiment,
  analyzeQuestionResponses,
  analyzeByDemographics,
  askQuestion,
  shouldInterviewerTerminate,
  type SurveyResponse,
} from "@/lib/survey-api"
import { DESKTOP_WORKSPACE_LAYOUT } from "@/lib/workspace-layout.mjs"
import {
  apiGenerateRespondentsFromConfig,
  apiExportSurveyResults,
  apiBuildSurveyResponses,
} from "@/lib/survey-api"

type SimulationMode = "interview" | "survey"
type Workspace = "config" | "results" | "analytics"

export default function ResearcherDashboard() {
  const layout = useResponsiveLayout()
  const [config, setConfig] = useState<SurveyConfig>(defaultSurveyConfig)
  const [isRunning, setIsRunning] = useState(false)
  const [mode, setMode] = useState<SimulationMode>("survey")
  const [modeSelected, setModeSelected] = useState(false)
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("config")
  const [configSheetOpen, setConfigSheetOpen] = useState(false)
  const [analyticsSheetOpen, setAnalyticsSheetOpen] = useState(false)
  
  // Current survey state
  const [currentSessions, setCurrentSessions] = useState<InterviewSession[]>([])
  const [currentRespondents, setCurrentRespondents] = useState<RespondentProfile[]>([])
  const [currentProgress, setCurrentProgress] = useState<SurveyProgress>({
    totalRespondents: 0,
    completedRespondents: 0,
    inProgressRespondents: 0,
    terminatedRespondents: 0,
    currentRespondentIndex: 0,
  })
  const [currentSentiment, setCurrentSentiment] = useState<SentimentData>({
    positive: 0,
    neutral: 0,
    negative: 0,
  })
  const [currentQuestionAnalysis, setCurrentQuestionAnalysis] = useState<QuestionAnalysis[]>([])
  const [currentDemographicAnalysis, setCurrentDemographicAnalysis] = useState<DemographicAnalysis[]>([])
  const [currentResponses, setCurrentResponses] = useState<SurveyResponse[]>([])
  
  // For tracking active respondent during simulation
  const [activeRespondentId, setActiveRespondentId] = useState<string | null>(null)
  
  // History viewing state
  const [viewingHistoryRecord, setViewingHistoryRecord] = useState<SurveyHistoryRecord | null>(null)

  const abortRef = useRef(false)

  // Determine which data to display based on whether viewing history
  const displaySessions = viewingHistoryRecord ? viewingHistoryRecord.sessions : currentSessions
  const displayRespondents = viewingHistoryRecord ? viewingHistoryRecord.respondents : currentRespondents
  const displayProgress = viewingHistoryRecord ? viewingHistoryRecord.progress : currentProgress
  const displaySentiment = viewingHistoryRecord ? viewingHistoryRecord.sentiment : currentSentiment
  const displayQuestionAnalysis = viewingHistoryRecord ? viewingHistoryRecord.questionAnalysis : currentQuestionAnalysis
  const displayDemographicAnalysis = viewingHistoryRecord ? viewingHistoryRecord.demographicAnalysis : currentDemographicAnalysis
  const displayQuestions = viewingHistoryRecord ? viewingHistoryRecord.config.questions : config.questions
  const displayConfig = viewingHistoryRecord ? viewingHistoryRecord.config : config
  const displayResponses =
    viewingHistoryRecord
      ? apiBuildSurveyResponses(
          viewingHistoryRecord.sessions,
          viewingHistoryRecord.config.title,
        )
      : currentResponses

  const runSimulation = useCallback(async () => {
    if (isRunning) return

    setActiveWorkspace("results")
    setConfigSheetOpen(false)

    // Exit history view when starting new simulation
    setViewingHistoryRecord(null)
    
    setIsRunning(true)
    setCurrentSessions([])
    setCurrentQuestionAnalysis([])
    setCurrentDemographicAnalysis([])
    setCurrentResponses([])
    abortRef.current = false

    try {
      // Generate respondents based on configs
      const fetchedRespondents = await apiGenerateRespondentsFromConfig(
        config.respondentConfigs,
      )
      setCurrentRespondents(fetchedRespondents)

      // Initialize sessions for all respondents
      const initialSessions: InterviewSession[] = fetchedRespondents.map(r => ({
        respondentId: r.id,
        status: "pending",
        dialog: [],
        completedQuestions: 0,
        totalQuestions: config.questions.length,
      }))
      setCurrentSessions(initialSessions)

      setCurrentProgress({
        totalRespondents: fetchedRespondents.length,
        completedRespondents: 0,
        inProgressRespondents: 0,
        terminatedRespondents: 0,
        currentRespondentIndex: 0,
      })

      // Process each respondent one by one
      for (let rIndex = 0; rIndex < fetchedRespondents.length; rIndex++) {
        if (abortRef.current) break

        const respondent = fetchedRespondents[rIndex]
        setActiveRespondentId(respondent.id)

        // Update session status to in_progress
        setCurrentSessions(prev => prev.map(s => 
          s.respondentId === respondent.id 
            ? { ...s, status: "in_progress", startTime: new Date() }
            : s
        ))

        setCurrentProgress(prev => ({
          ...prev,
          currentRespondentIndex: rIndex,
          inProgressRespondents: 1,
        }))

        const dialog: DialogMessage[] = []
        let terminated = false
        let terminationReason: string | undefined

        // Ask each question
        for (let qIndex = 0; qIndex < config.questions.length; qIndex++) {
          if (abortRef.current || terminated) break

          const question = config.questions[qIndex]

          // Add interviewer's question to dialog
          const questionMessage: DialogMessage = {
            id: `q-${Date.now()}-${question.id}`,
            role: "interviewer",
            content: question.question,
            timestamp: new Date(),
            questionId: question.id,
          }
          dialog.push(questionMessage)

          // Update session with new message
          setCurrentSessions(prev => prev.map(s => 
            s.respondentId === respondent.id 
              ? { ...s, dialog: [...dialog] }
              : s
          ))

          // Small delay before response
          await new Promise(resolve => setTimeout(resolve, 300))

          // Get respondent's response
          const response = await askQuestion(respondent, question, dialog)
          dialog.push(response.message)

          // Update session with response
          setCurrentSessions(prev => {
            const updated = prev.map(s => 
              s.respondentId === respondent.id 
                ? { 
                    ...s, 
                    dialog: [...dialog],
                    completedQuestions: qIndex + 1,
                  }
                : s
            )
            // Update analytics & structured responses
            setCurrentSentiment(analyzeSentiment(updated))
            setCurrentQuestionAnalysis(analyzeQuestionResponses(updated, config.questions))
            setCurrentDemographicAnalysis(analyzeByDemographics(updated, fetchedRespondents, config.questions))
            setCurrentResponses(apiBuildSurveyResponses(updated, config.title))
            return updated
          })

          // Check if respondent terminated
          if (response.shouldTerminate) {
            terminated = true
            terminationReason = response.reason
            break
          }

          // Check if interviewer should terminate
          const interviewerDecision = shouldInterviewerTerminate(dialog, response)
          if (interviewerDecision.shouldTerminate) {
            terminated = true
            terminationReason = interviewerDecision.reason
            break
          }
        }

        // Finalize session
        const finalStatus: InterviewSession["status"] = terminated
          ? (terminationReason?.includes("受访者") ? "terminated_by_respondent" : "terminated_by_interviewer")
          : "completed"

        setCurrentSessions(prev => {
          const updated = prev.map(s => 
            s.respondentId === respondent.id 
              ? { 
                  ...s, 
                  status: finalStatus,
                  terminationReason,
                  endTime: new Date(),
                }
              : s
          )
          // Final analytics & responses update for this respondent
          setCurrentSentiment(analyzeSentiment(updated))
          setCurrentQuestionAnalysis(analyzeQuestionResponses(updated, config.questions))
          setCurrentDemographicAnalysis(analyzeByDemographics(updated, fetchedRespondents, config.questions))
          setCurrentResponses(apiBuildSurveyResponses(updated, config.title))
          return updated
        })

        // Update progress
        setCurrentProgress(prev => ({
          ...prev,
          completedRespondents: terminated ? prev.completedRespondents : prev.completedRespondents + 1,
          terminatedRespondents: terminated ? prev.terminatedRespondents + 1 : prev.terminatedRespondents,
          inProgressRespondents: 0,
        }))
      }

    } catch (error) {
      console.error("Simulation error:", error)
    } finally {
      setIsRunning(false)
      setActiveRespondentId(null)
    }
  }, [config, isRunning])

  const handleExport = useCallback(
    async (format: "json" | "csv") => {
      try {
        const blob = await apiExportSurveyResults(
          displaySessions,
          displayRespondents,
          format,
        )
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `survey-results.${format}`
        a.click()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error("Export error:", error)
      }
    },
    [displaySessions, displayRespondents]
  )

  const handleSelectRespondent = useCallback((id: string) => {
    // Could be used for additional actions
  }, [])

  const handleModeSelection = useCallback((selection: SimulationMode) => {
    setMode(selection)
    setModeSelected(true)
  }, [])

  const handleLoadHistory = useCallback((record: SurveyHistoryRecord) => {
    setViewingHistoryRecord(record)
  }, [])

  const handleReturnToCurrent = useCallback(() => {
    setViewingHistoryRecord(null)
  }, [])

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

  const analyticsPanel = (
    <AnalyticsPanel
      progress={displayProgress}
      sentiment={displaySentiment}
      sessions={displaySessions}
      respondents={displayRespondents}
      questions={displayQuestions}
      questionAnalysis={displayQuestionAnalysis}
      demographicAnalysis={displayDemographicAnalysis}
      config={displayConfig}
      onExport={handleExport}
      isRunning={isRunning}
      onLoadHistory={handleLoadHistory}
      onReturnToCurrent={handleReturnToCurrent}
      viewingHistoryRecord={viewingHistoryRecord}
    />
  )

  const workspaceItems = [
    { value: "config" as const, label: "配置", icon: Settings2 },
    {
      value: "results" as const,
      label: mode === "interview" ? "访谈" : "结果",
      icon: mode === "interview" ? MessageSquare : ClipboardList,
    },
    { value: "analytics" as const, label: "分析", icon: BarChart3 },
  ]

  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-primary/3 to-transparent rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="px-3 py-3 sm:px-4 xl:px-6 xl:py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent">
                <Cpu className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 text-base font-semibold leading-tight text-foreground sm:text-lg">
                  Survey Agent Simulator
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                </h1>
                <p className="mt-1 hidden text-xs text-muted-foreground min-[430px]:block">
                  {mode === "interview"
                    ? "AI 驱动的虚拟访谈模拟平台"
                    : "AI 驱动的大规模问卷调研模拟平台"}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center rounded-full border border-border/60 bg-secondary/40 p-0.5 text-xs md:flex-none">
                <button
                  type="button"
                  className={`flex-1 rounded-full px-3 py-1 text-[11px] transition md:flex-none ${
                    mode === "interview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setMode("interview")}
                >
                  访谈模式
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-full px-3 py-1 text-[11px] transition md:flex-none ${
                    mode === "survey"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setMode("survey")}
                >
                  问卷模式
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-border/50 bg-secondary/50 px-3 py-1.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isRunning 
                      ? "bg-emerald-400 animate-pulse" 
                      : viewingHistoryRecord 
                      ? "bg-amber-400"
                      : "bg-muted-foreground"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {isRunning ? "运行中" : viewingHistoryRecord ? "查看历史" : "待机"}
                </span>
              </div>
            </div>
          </div>
        </div>
        {layout === "mobile" && (
          <nav
            aria-label="工作区导航"
            className="grid grid-cols-3 border-t border-border/50 bg-background/90 p-1"
          >
            {workspaceItems.map(item => {
              const Icon = item.icon
              const isActive = activeWorkspace === item.value

              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveWorkspace(item.value)}
                  className={
                    isActive
                      ? "flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary/15 text-xs font-medium text-primary"
                      : "flex h-9 items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground transition hover:bg-secondary/40 hover:text-foreground"
                  }
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              )
            })}
          </nav>
        )}
      </header>

      <main className="relative z-10 min-h-0 min-w-0 flex-1 overflow-hidden">
        {layout === "mobile" && (
          <section className="h-full min-h-0 min-w-0 overflow-hidden">
            {activeWorkspace === "config" && configPanel}
            {activeWorkspace === "results" && resultsPanel}
            {activeWorkspace === "analytics" && analyticsPanel}
          </section>
        )}

        {layout === "tablet" && (
          <>
            <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b border-border/50 bg-card/40 px-3 py-2 backdrop-blur-xl">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfigSheetOpen(true)}
                >
                  <PanelLeftOpen className="size-4" />
                  配置
                </Button>
                <span className="text-xs text-muted-foreground">
                  {mode === "interview" ? "访谈工作区" : "问卷结果工作区"}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAnalyticsSheetOpen(true)}
                >
                  分析
                  <PanelRightOpen className="size-4" />
                </Button>
              </div>
              <section className="min-h-0 min-w-0 flex-1 overflow-hidden bg-gradient-to-b from-background to-card/20">
                {resultsPanel}
              </section>
            </div>

            <Sheet open={configSheetOpen} onOpenChange={setConfigSheetOpen}>
              <SheetContent
                side="left"
                className="w-[min(92vw,420px)] max-w-none gap-0 p-0"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>调研配置</SheetTitle>
                  <SheetDescription>编辑调研问题和受访者配置</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {configPanel}
                </div>
              </SheetContent>
            </Sheet>

            <Sheet
              open={analyticsSheetOpen}
              onOpenChange={setAnalyticsSheetOpen}
            >
              <SheetContent
                side="right"
                className="w-[min(92vw,420px)] max-w-none gap-0 p-0"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>调研分析</SheetTitle>
                  <SheetDescription>查看调研进度与分析结果</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {analyticsPanel}
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}

        {layout === "desktop" && (
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="survey-desktop-workspace-layout"
            className="h-full min-h-0 min-w-0 overflow-hidden"
          >
            <ResizablePanel
              id="survey-config-workspace"
              order={1}
              defaultSize={DESKTOP_WORKSPACE_LAYOUT.defaults.config}
              minSize={DESKTOP_WORKSPACE_LAYOUT.config.min}
              maxSize={DESKTOP_WORKSPACE_LAYOUT.config.max}
              className="min-h-0 min-w-0 overflow-hidden bg-card/30 backdrop-blur-xl"
            >
              {configPanel}
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="调整配置与结果区域宽度"
            />
            <ResizablePanel
              id="survey-results-workspace"
              order={2}
              defaultSize={DESKTOP_WORKSPACE_LAYOUT.defaults.results}
              minSize={DESKTOP_WORKSPACE_LAYOUT.results.min}
              className="min-h-0 min-w-0 overflow-hidden bg-gradient-to-b from-background to-card/20 backdrop-blur-xl"
            >
              {resultsPanel}
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label="调整结果与分析区域宽度"
            />
            <ResizablePanel
              id="survey-analytics-workspace"
              order={3}
              defaultSize={DESKTOP_WORKSPACE_LAYOUT.defaults.analytics}
              minSize={DESKTOP_WORKSPACE_LAYOUT.analytics.min}
              maxSize={DESKTOP_WORKSPACE_LAYOUT.analytics.max}
              className="min-h-0 min-w-0 overflow-hidden bg-card/30 backdrop-blur-xl"
            >
              {analyticsPanel}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </main>

      {!modeSelected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-xl">
          <div className="w-full max-w-[380px] rounded-2xl border border-border/70 bg-card/90 p-5 shadow-2xl sm:p-6">
            <h2 className="text-lg font-semibold text-foreground mb-3">
              请选择启动模式
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              新访谈/问卷环节开始前请选择一种模式，选定后即可继续。
            </p>
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => handleModeSelection("survey")}
                className="w-full rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:border-primary"
              >
                <span className="text-base font-semibold">问卷模式</span>
                <p className="text-[11px] text-muted-foreground mt-1">
                  一次性向大批量虚拟受访者分发问卷并获取统计结果
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleModeSelection("interview")}
                className="w-full rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:border-primary"
              >
                <span className="text-base font-semibold">访谈模式</span>
                <p className="text-[11px] text-muted-foreground mt-1">
                  模拟逐个受访者的深度访谈流程
                </p>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
