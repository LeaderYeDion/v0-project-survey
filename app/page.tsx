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
  type RoundSnapshot,
  type SimulationMode,
  type Project,
  type Questionnaire,
  type CreateProjectInput,
  type CreateQuestionnaireInput,
  apiCreateRound,
  apiFetchRound,
  apiExportSurveyResults,
  apiListProjects,
  apiCreateProject,
  apiListQuestionnaires,
  apiCreateQuestionnaire,
  apiGetQuestionnaire,
  apiSaveQuestionnaireDraft,
  abortOutstandingSurveyRequests,
  SurveyApiError,
} from "@/lib/survey-api"
import { DESKTOP_WORKSPACE_LAYOUT } from "@/lib/workspace-layout.mjs"
import { useI18n } from "@/components/locale-provider"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { useAuthSession } from "@/components/auth-session-provider"
import { ResearchResourceSelector } from "@/components/research-resource-selector"
import { CreateProjectDialog } from "@/components/create-project-dialog"
import { CreateQuestionnaireDialog } from "@/components/create-questionnaire-dialog"
import {
  createDraftSaveQueue,
  type DraftSaveJob,
} from "@/lib/draft-save-queue"

type Workspace = "config" | "results" | "analytics"

interface QuestionnaireDraftSaveJob extends DraftSaveJob {
  config: SurveyConfig
  locale: "en-US" | "zh-CN"
}

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
  const { user, status: authStatus, logout } = useAuthSession()
  const [config, setConfig] = useState<SurveyConfig>(EMPTY_CONFIG)
  const [currentRun, setCurrentRun] = useState<RoundSnapshot | null>(null)
  const [mode, setMode] = useState<SimulationMode>("survey")
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace>("config")
  const [configSheetOpen, setConfigSheetOpen] = useState(false)
  const [analyticsSheetOpen, setAnalyticsSheetOpen] = useState(false)
  const [viewingHistoryRecord, setViewingHistoryRecord] = useState<SurveyHistoryRecord | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [questionnaireId, setQuestionnaireId] = useState<string | null>(null)
  const [draftRevision, setDraftRevision] = useState(0)
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "failed" | "conflicted"
  >("idle")
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [resourceError, setResourceError] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [questionnaireDialogOpen, setQuestionnaireDialogOpen] = useState(false)
  const persistedConfigRef = useRef("")
  const revisionByQuestionnaireRef = useRef(new Map<string, number>())
  const configRef = useRef(config)
  const questionnaireIdRef = useRef(questionnaireId)
  const performDraftSaveRef = useRef(
    async (_job: QuestionnaireDraftSaveJob): Promise<void> => {},
  )
  const draftSaveQueueRef = useRef<
    ReturnType<typeof createDraftSaveQueue<QuestionnaireDraftSaveJob>> | null
  >(null)
  if (!draftSaveQueueRef.current) {
    draftSaveQueueRef.current = createDraftSaveQueue(job =>
      performDraftSaveRef.current(job),
    )
  }
  configRef.current = config
  questionnaireIdRef.current = questionnaireId

  const isRunning =
    currentRun?.status === "queued" ||
    currentRun?.status === "running" ||
    currentRun?.status === "pausing"

  const isSurveyConfigValid = (candidate: SurveyConfig) =>
    candidate.title.trim().length > 0 &&
    candidate.maxResponseTime > 0 &&
    candidate.questions.length > 0 &&
    candidate.respondentConfigs.length > 0 &&
    candidate.respondentConfigs.every(group => group.count > 0) &&
    candidate.questions.every(question => {
      if (!question.question.trim()) return false
      if (question.type === "choice") return Boolean(question.options?.length)
      if (question.type === "scale") {
        return Boolean(question.scale && question.scale.min < question.scale.max)
      }
      return true
    })

  const runDisabled =
    !questionnaireId ||
    !isSurveyConfigValid(config) ||
    saveStatus !== "saved" ||
    isRunning

  const applyQuestionnaire = useCallback((questionnaire: Questionnaire) => {
    questionnaireIdRef.current = questionnaire.id
    setQuestionnaireId(questionnaire.id)
    setMode(questionnaire.mode)
    setConfig(questionnaire.config)
    setDraftRevision(questionnaire.draftRevision)
    revisionByQuestionnaireRef.current.set(
      questionnaire.id,
      questionnaire.draftRevision,
    )
    setSavedAt(questionnaire.updatedAt)
    setSaveStatus("saved")
    persistedConfigRef.current = JSON.stringify(questionnaire.config)
    setCurrentRun(null)
    setViewingHistoryRecord(null)
  }, [])

  useEffect(() => {
    if (authStatus !== "authenticated") return
    setResourceError(false)
    apiListProjects(locale)
      .then(ownedProjects => {
        setProjects(ownedProjects)
        setProjectId(current =>
          current && ownedProjects.some(project => project.id === current)
            ? current
            : ownedProjects[0]?.id ?? null,
        )
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResourceError(true)
        }
      })
  }, [authStatus, locale])

  useEffect(() => {
    if (!projectId) {
      setQuestionnaires([])
      setQuestionnaireId(null)
      return
    }
    setResourceError(false)
    const loadingProjectId = projectId
    apiListQuestionnaires(locale, projectId)
      .then(ownedQuestionnaires => {
        if (loadingProjectId !== projectId) return
        setQuestionnaires(ownedQuestionnaires)
        const selected = ownedQuestionnaires.find(item => item.id === questionnaireId)
        setQuestionnaireId(selected?.id ?? ownedQuestionnaires[0]?.id ?? null)
        if (ownedQuestionnaires.length === 0) {
          setConfig(EMPTY_CONFIG)
          setSaveStatus("idle")
        }
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResourceError(true)
        }
      })
  }, [locale, projectId])

  useEffect(() => {
    if (!questionnaireId) return
    apiGetQuestionnaire(locale, questionnaireId)
      .then(questionnaire => {
        if (questionnaireIdRef.current === questionnaire.id) {
          applyQuestionnaire(questionnaire)
        }
      })
      .catch(error => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResourceError(true)
        }
      })
  }, [applyQuestionnaire, locale, questionnaireId])

  performDraftSaveRef.current = async job => {
    if (questionnaireIdRef.current === job.resourceId) {
      setSaveStatus("saving")
    }

    try {
      const saved = await apiSaveQuestionnaireDraft(job.locale, job.resourceId, {
        config: job.config,
        expectedRevision:
          revisionByQuestionnaireRef.current.get(job.resourceId) ?? job.revision,
      })
      revisionByQuestionnaireRef.current.set(saved.id, saved.draftRevision)
      if (questionnaireIdRef.current !== job.resourceId) return
      setDraftRevision(saved.draftRevision)
      persistedConfigRef.current = JSON.stringify(saved.config)
      setSavedAt(saved.updatedAt)
      setQuestionnaires(current =>
        current.map(item => (item.id === saved.id ? saved : item)),
      )
      setSaveStatus(
        JSON.stringify(configRef.current) === persistedConfigRef.current
          ? "saved"
          : "dirty",
      )
    } catch (error) {
      if (questionnaireIdRef.current !== job.resourceId) return
      if (error instanceof SurveyApiError && error.code === "DRAFT_CONFLICT") {
        setSaveStatus("conflicted")
        if (window.confirm(messages.resources.draftConflict)) {
          const serverDraft = await apiGetQuestionnaire(job.locale, job.resourceId)
          if (questionnaireIdRef.current === job.resourceId) {
            applyQuestionnaire(serverDraft)
          }
        }
      } else if (!(error instanceof DOMException && error.name === "AbortError")) {
        setSaveStatus("failed")
      }
    }
  }

  useEffect(() => {
    if (!questionnaireId) return
    const serialized = JSON.stringify(config)
    if (serialized === persistedConfigRef.current) return

    setSaveStatus("dirty")
    const savingQuestionnaireId = questionnaireId
    const timer = window.setTimeout(() => {
      void draftSaveQueueRef.current?.enqueue({
        resourceId: savingQuestionnaireId,
        revision: draftRevision,
        config,
        locale,
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [
    applyQuestionnaire,
    config,
    draftRevision,
    locale,
    messages.resources.draftConflict,
    questionnaireId,
  ])

  useEffect(() => {
    if (!currentRun || !isRunning) return
    const controller = new AbortController()
    const timer = window.setInterval(async () => {
      try {
        const next = await apiFetchRound(locale, currentRun.id, controller.signal)
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
  const displayInferenceResults =
    viewingHistoryRecord?.inferenceResults ?? currentRun?.inferenceResults ?? []
  const displayInferenceSummary =
    viewingHistoryRecord?.inferenceSummary ?? currentRun?.inferenceSummary ?? []
  const displaySource = viewingHistoryRecord
    ? { type: "history" as const, id: viewingHistoryRecord.id }
    : currentRun
      ? { type: "run" as const, id: currentRun.id }
      : null

  const runSimulation = useCallback(async () => {
    if (runDisabled || !questionnaireId) return

    setActiveWorkspace("results")
    setConfigSheetOpen(false)
    setViewingHistoryRecord(null)

    try {
      setCurrentRun(await apiCreateRound(locale, questionnaireId))
    } catch (error) {
      console.error("Simulation error:", error)
    }
  }, [locale, questionnaireId, runDisabled])

  const handleProjectChange = useCallback((nextProjectId: string) => {
    abortOutstandingSurveyRequests()
    draftSaveQueueRef.current?.discardPendingExcept("")
    questionnaireIdRef.current = null
    setProjectId(nextProjectId)
    setQuestionnaireId(null)
    setConfig(EMPTY_CONFIG)
    setSaveStatus("idle")
    setCurrentRun(null)
    setViewingHistoryRecord(null)
  }, [])

  const handleQuestionnaireChange = useCallback((nextQuestionnaireId: string) => {
    abortOutstandingSurveyRequests()
    draftSaveQueueRef.current?.discardPendingExcept(nextQuestionnaireId)
    questionnaireIdRef.current = nextQuestionnaireId
    setQuestionnaireId(nextQuestionnaireId)
    setSaveStatus("idle")
    setCurrentRun(null)
    setViewingHistoryRecord(null)
  }, [])

  const handleCreateProject = useCallback(async (input: CreateProjectInput) => {
    const created = await apiCreateProject(locale, input)
    setProjects(current => [created, ...current])
    handleProjectChange(created.id)
  }, [handleProjectChange, locale])

  const handleCreateQuestionnaire = useCallback(async (input: CreateQuestionnaireInput) => {
    if (!projectId) return
    const created = await apiCreateQuestionnaire(locale, projectId, input)
    setQuestionnaires(current => [created, ...current])
    applyQuestionnaire(created)
    lockLocale()
  }, [applyQuestionnaire, locale, lockLocale, projectId])

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
      runDisabled={runDisabled}
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
        inferenceResults={displayInferenceResults}
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
      inferenceResults={displayInferenceResults}
      inferenceSummary={displayInferenceSummary}
      config={displayConfig}
      onExport={handleExport}
      isRunning={isRunning}
      onLoadHistory={handleLoadHistory}
      onReturnToCurrent={handleReturnToCurrent}
      viewingHistoryRecord={viewingHistoryRecord}
      source={displaySource}
      legacyHistoryEnabled={false}
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

  const saveLabel =
    saveStatus === "saving"
      ? messages.resources.draftSaving
      : saveStatus === "saved" && savedAt
        ? messages.resources.draftSaved(
            new Intl.DateTimeFormat(locale, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date(savedAt)),
          )
        : saveStatus === "failed"
          ? messages.resources.draftFailed
          : saveStatus === "conflicted"
            ? messages.resources.draftConflict
            : saveStatus === "dirty"
              ? messages.resources.draftDirty
              : null

  if (authStatus !== "authenticated" || !user) {
    return <div className="h-dvh bg-background" aria-busy={authStatus === "loading"} />
  }

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
                role="status"
                aria-label={messages.dashboard.chooseMode}
                className="flex min-w-0 flex-1 items-center rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 text-[11px] text-foreground md:flex-none"
              >
                {mode === "interview"
                  ? messages.dashboard.interviewMode
                  : messages.dashboard.surveyMode}
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
              <ThemeSwitcher />
              <span className="max-w-32 truncate text-xs text-muted-foreground">
                {user.username}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void logout()}>
                {messages.auth.logout}
              </Button>
            </div>
          </div>
          {projects.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/40 pt-3">
              <ResearchResourceSelector
                projects={projects}
                questionnaires={questionnaires}
                projectId={projectId}
                questionnaireId={questionnaireId}
                onProjectChange={handleProjectChange}
                onQuestionnaireChange={handleQuestionnaireChange}
                onCreateProject={() => setProjectDialogOpen(true)}
                onCreateQuestionnaire={() => setQuestionnaireDialogOpen(true)}
              />
              {saveLabel && (
                <span role={saveStatus === "failed" || saveStatus === "conflicted" ? "alert" : "status"} className="text-xs text-muted-foreground">
                  {saveLabel}
                </span>
              )}
            </div>
          )}
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
        {resourceError && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {messages.resources.loadFailed}
          </p>
        )}
        {projects.length === 0 ? (
          <section className="flex h-full items-center justify-center p-6">
            <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-card/80 p-8 text-center shadow-xl">
              <h2 className="text-xl font-semibold">{messages.resources.noProjectsTitle}</h2>
              <p className="text-sm text-muted-foreground">{messages.resources.noProjectsDescription}</p>
              <Button type="button" onClick={() => setProjectDialogOpen(true)}>
                {messages.resources.createProject}
              </Button>
            </div>
          </section>
        ) : !questionnaireId ? (
          <section className="flex h-full items-center justify-center p-6">
            <div className="max-w-md space-y-4 rounded-2xl border border-border/60 bg-card/80 p-8 text-center shadow-xl">
              <p className="text-sm text-muted-foreground">{messages.resources.noQuestionnaires}</p>
              <Button type="button" onClick={() => setQuestionnaireDialogOpen(true)}>
                {messages.resources.createQuestionnaire}
              </Button>
            </div>
          </section>
        ) : (
          <>
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
          </>
        )}
      </main>

      <CreateProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        onCreate={handleCreateProject}
      />
      <CreateQuestionnaireDialog
        open={questionnaireDialogOpen}
        onOpenChange={setQuestionnaireDialogOpen}
        onCreate={handleCreateQuestionnaire}
      />
    </div>
  )
}
