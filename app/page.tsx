"use client"

import { useState, useCallback, useEffect, useRef } from "react"
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  type SurveyConfig,
  type SurveyProgress,
  type SentimentData,
  type SurveyHistoryRecord,
  type RunSnapshot,
  type SimulationMode,
  apiFetchDefaultTemplate,
  apiCreateRun,
  apiFetchRun,
  apiExportSurveyResults,
} from "@/lib/survey-api"
import { DESKTOP_WORKSPACE_LAYOUT } from "@/lib/workspace-layout.mjs"
import { createLatestRequestTracker } from "@/lib/latest-request"
import type { Locale } from "@/lib/i18n/locale"
import { useI18n } from "@/components/locale-provider"
import { LanguageSwitcher } from "@/components/language-switcher"

type Workspace = "config" | "results" | "analytics"

const EMPTY_CONFIG: SurveyConfig = {
  title: "",
  description: "",
  questions: [],
  maxResponseTime: 30,
  respondentConfigs: [],
}

const EMPTY_PROGRESS: SurveyProgress = {
  totalRespondents: 0,
  completedRespondents: 0,
  inProgressRespondents: 0,
  terminatedRespondents: 0,
  currentRespondentIndex: 0,
}

const EMPTY_SENTIMENT: SentimentData = {
  positive: 0,
  neutral: 0,
  negative: 0,
}

export default function ResearcherDashboard() {
  const layout = useResponsiveLayout()
  const { locale, messages, lockLocale } = useI18n()
  const [config, setConfig] = useState<SurveyConfig>(EMPTY_CONFIG)
  const [currentRun, setCurrentRun] = useState<RunSnapshot | null>(null)
  const [mode, setMode] = useState<SimulationMode>("survey")
  const [modeSelected, setModeSelected] = useState(false)
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("config")
  const [configSheetOpen, setConfigSheetOpen] = useState(false)
  const [analyticsSheetOpen, setAnalyticsSheetOpen] = useState(false)
  const [viewingHistoryRecord, setViewingHistoryRecord] = useState<SurveyHistoryRecord | null>(null)
  const templateRequestsRef = useRef(createLatestRequestTracker())
  const [loadedTemplateLocale, setLoadedTemplateLocale] =
    useState<Locale | null>(null)
  const [templateError, setTemplateError] = useState(false)

  const isRunning =
    currentRun?.status === "queued" || currentRun?.status === "running"

  useEffect(() => {
    const controller = new AbortController()
    const requestId = templateRequestsRef.current.begin()
    setLoadedTemplateLocale(null)
    setTemplateError(false)
    apiFetchDefaultTemplate(locale, controller.signal)
      .then(nextConfig => {
        if (
          controller.signal.aborted ||
          !templateRequestsRef.current.isLatest(requestId)
        ) return
        setConfig(nextConfig)
        setLoadedTemplateLocale(locale)
      })
      .catch(error => {
        if (
          !controller.signal.aborted &&
          templateRequestsRef.current.isLatest(requestId)
        ) {
          console.error("Template error:", error)
          setTemplateError(true)
        }
      })
    return () => controller.abort()
  }, [locale])

  useEffect(() => {
    if (!currentRun || !isRunning) return
    const controller = new AbortController()
    const timer = window.setInterval(async () => {
      try {
        const next = await apiFetchRun(locale, currentRun.id, controller.signal)
        setCurrentRun(next)
        if (!["queued", "running"].includes(next.status)) {
          window.clearInterval(timer)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Polling error:", error)
          window.clearInterval(timer)
        }
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [currentRun?.id, isRunning, locale])

  const displaySessions =
    viewingHistoryRecord?.sessions ?? currentRun?.sessions ?? []
  const displayRespondents =
    viewingHistoryRecord?.respondents ?? currentRun?.respondents ?? []
  const displayProgress =
    viewingHistoryRecord?.progress ?? currentRun?.progress ?? EMPTY_PROGRESS
  const displaySentiment =
    viewingHistoryRecord?.sentiment ?? currentRun?.sentiment ?? EMPTY_SENTIMENT
  const displayQuestionAnalysis =
    viewingHistoryRecord?.questionAnalysis ?? currentRun?.questionAnalysis ?? []
  const displayDemographicAnalysis =
    viewingHistoryRecord?.demographicAnalysis ??
    currentRun?.demographicAnalysis ??
    []
  const displayQuestions = viewingHistoryRecord ? viewingHistoryRecord.config.questions : config.questions
  const displayConfig = viewingHistoryRecord ? viewingHistoryRecord.config : config
  const displayResponses =
    viewingHistoryRecord?.responses ?? currentRun?.responses ?? []
  const displaySource = viewingHistoryRecord
    ? { type: "history" as const, id: viewingHistoryRecord.id }
    : currentRun
      ? { type: "run" as const, id: currentRun.id }
      : null

  const runSimulation = useCallback(async () => {
    if (isRunning || config.questions.length === 0) return

    setActiveWorkspace("results")
    setConfigSheetOpen(false)
    setViewingHistoryRecord(null)

    try {
      setCurrentRun(await apiCreateRun(locale, mode, config))
    } catch (error) {
      console.error("Simulation error:", error)
    }
  }, [config, isRunning, locale, mode])

  const handleExport = useCallback(
    async (format: "json" | "csv") => {
      if (!displaySource) return
      try {
        const blob = await apiExportSurveyResults(locale, displaySource, format)
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
    [displaySource, locale]
  )

  const handleSelectRespondent = useCallback((id: string) => {
    // Could be used for additional actions
  }, [])

  const handleModeSelection = useCallback(
    (selection: SimulationMode) => {
      if (loadedTemplateLocale !== locale) return
      setMode(selection)
      lockLocale()
      setModeSelected(true)
    },
    [loadedTemplateLocale, locale, lockLocale],
  )

  const handleLoadHistory = useCallback((record: SurveyHistoryRecord) => {
    setViewingHistoryRecord(record)
    setMode(record.mode)
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
        currentRespondentId={currentRun?.activeRespondentId ?? null}
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
      source={displaySource}
    />
  )

  const workspaceItems = [
    {
      value: "config" as const,
      label: messages.dashboard.config,
      icon: Settings2,
    },
    {
      value: "results" as const,
      label:
        mode === "interview"
          ? messages.dashboard.interview
          : messages.dashboard.results,
      icon: mode === "interview" ? MessageSquare : ClipboardList,
    },
    {
      value: "analytics" as const,
      label: messages.dashboard.analytics,
      icon: BarChart3,
    },
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
                  {messages.common.productName}
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                </h1>
                <p className="mt-1 hidden text-xs text-muted-foreground min-[430px]:block">
                  {mode === "interview"
                    ? messages.dashboard.interviewTagline
                    : messages.dashboard.surveyTagline}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4 md:flex-nowrap">
              <div
                role="group"
                aria-label={messages.dashboard.chooseMode}
                className="flex min-w-0 flex-1 items-center rounded-full border border-border/60 bg-secondary/40 p-0.5 text-xs md:flex-none"
              >
                <button
                  type="button"
                  aria-pressed={mode === "interview"}
                  className={`flex-1 rounded-full px-3 py-1 text-[11px] transition md:flex-none ${
                    mode === "interview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setMode("interview")}
                >
                  {messages.dashboard.interviewMode}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "survey"}
                  className={`flex-1 rounded-full px-3 py-1 text-[11px] transition md:flex-none ${
                    mode === "survey"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setMode("survey")}
                >
                  {messages.dashboard.surveyMode}
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
                  {isRunning
                    ? messages.dashboard.running
                    : viewingHistoryRecord
                      ? messages.dashboard.viewingHistory
                      : messages.dashboard.idle}
                </span>
              </div>
            </div>
          </div>
        </div>
        {layout === "mobile" && (
          <nav
            aria-label={messages.dashboard.workspaceNavigation}
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
                  {messages.dashboard.config}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {mode === "interview"
                    ? messages.dashboard.interviewWorkspace
                    : messages.dashboard.surveyWorkspace}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAnalyticsSheetOpen(true)}
                >
                  {messages.dashboard.analytics}
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
                  <SheetTitle>{messages.dashboard.configSheetTitle}</SheetTitle>
                  <SheetDescription>
                    {messages.dashboard.configSheetDescription}
                  </SheetDescription>
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
                  <SheetTitle>{messages.dashboard.analyticsSheetTitle}</SheetTitle>
                  <SheetDescription>
                    {messages.dashboard.analyticsSheetDescription}
                  </SheetDescription>
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
              aria-label={messages.dashboard.resizeConfigResults}
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
              aria-label={messages.dashboard.resizeResultsAnalytics}
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

      <AlertDialog open={!modeSelected}>
        <AlertDialogContent
          overlayClassName="bg-background/95 backdrop-blur-xl"
          className="gap-0 rounded-2xl border-border/70 bg-card/90 p-5 shadow-2xl sm:max-w-[380px] sm:p-6"
        >
          <div className="absolute right-5 top-5 sm:right-6 sm:top-6">
            <LanguageSwitcher />
          </div>
          <AlertDialogTitle className="mb-3 min-h-9 pr-36 text-lg text-foreground">
            {messages.dashboard.chooseMode}
          </AlertDialogTitle>
          <AlertDialogDescription className="mb-6">
            {messages.dashboard.chooseModeDescription}
          </AlertDialogDescription>
          {templateError && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {messages.errors.template}
            </p>
          )}
          <div className="space-y-4">
            <button
              type="button"
              disabled={loadedTemplateLocale !== locale}
              onClick={() => handleModeSelection("survey")}
              className="w-full rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:border-primary"
            >
              <span className="text-base font-semibold">
                {messages.dashboard.surveyMode}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                {messages.dashboard.surveyModeDescription}
              </p>
            </button>
            <button
              type="button"
              disabled={loadedTemplateLocale !== locale}
              onClick={() => handleModeSelection("interview")}
              className="w-full rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-left text-sm font-medium text-foreground transition hover:border-primary"
            >
              <span className="text-base font-semibold">
                {messages.dashboard.interviewMode}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                {messages.dashboard.interviewModeDescription}
              </p>
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
