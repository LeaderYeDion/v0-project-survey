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
  type RoundSnapshot,
  type SimulationMode,
  type Project,
  type Questionnaire,
  type CreateProjectInput,
  type CreateQuestionnaireInput,
  apiCreateRound,
  apiFetchRound,
  apiListProjectRounds,
  apiPauseRound,
  apiResumeRound,
  apiCancelRound,
  apiRetryRound,
  apiCopyRound,
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
import { RunControlBar } from "@/components/run-control-bar"
import { RoundHistoryDialog } from "@/components/round-history-dialog"
import { createEffectRequestTracker } from "@/lib/latest-request"
import {
  createRoundResourceRequestGuard,
  createRunMutationGuard,
  mergePolledRoundSnapshot,
  getRoundDisplayState,
  shouldPollRound,
  type RunAction,
} from "@/lib/run-actions"

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
  failedRespondents: 0,
  incompleteRespondents: 0,
  answeredQuestions: 0,
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
  const [viewingHistoryRound, setViewingHistoryRound] = useState<RoundSnapshot | null>(null)
  const [roundHistory, setRoundHistory] = useState<RoundSnapshot[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [copyingRoundId, setCopyingRoundId] = useState<string | null>(null)
  const [pendingRunAction, setPendingRunAction] = useState<RunAction | null>(null)
  const [runFeedback, setRunFeedback] = useState<{
    kind: "success" | "error"
    message: string
  } | null>(null)
  const [focusedRespondentId, setFocusedRespondentId] = useState<string | null>(null)
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
  const projectIdRef = useRef(projectId)
  const questionnaireIdRef = useRef(questionnaireId)
  const resourceIdentityRef = useRef("")
  resourceIdentityRef.current = JSON.stringify([user?.id, authStatus, locale])
  const projectLoadTrackerRef = useRef(createEffectRequestTracker(
    () => resourceIdentityRef.current,
  ))
  const questionnaireListTrackerRef = useRef(createEffectRequestTracker(
    () => JSON.stringify([resourceIdentityRef.current, projectIdRef.current]),
  ))
  const questionnaireLoadTrackerRef = useRef(createEffectRequestTracker(
    () => JSON.stringify([resourceIdentityRef.current, projectIdRef.current, questionnaireIdRef.current]),
  ))
  const runMutationGuardRef = useRef(createRunMutationGuard())
  const roundResourceRequestGuardRef = useRef(
    createRoundResourceRequestGuard(() => ({
      projectId: projectIdRef.current,
      questionnaireId: questionnaireIdRef.current,
    })),
  )
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
  projectIdRef.current = projectId
  questionnaireIdRef.current = questionnaireId

  const isRunning = currentRun ? shouldPollRound(currentRun.status) : false

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
    if (questionnaireIdRef.current !== questionnaire.id) {
      roundResourceRequestGuardRef.current.invalidate()
      setHistoryLoading(false)
      setHistoryError(null)
      setCopyingRoundId(null)
    }
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
    setViewingHistoryRound(null)
    setFocusedRespondentId(null)
  }, [])

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return
    const request = projectLoadTrackerRef.current.begin()
    setResourceError(false)
    void request.run(signal => apiListProjects(locale, signal))
      .then(result => {
        if (result.status === "stale") return
        if (result.status === "error") {
          if (!(result.error instanceof DOMException && result.error.name === "AbortError")) setResourceError(true)
          return
        }
        const ownedProjects = result.value
        setProjects(ownedProjects)
        setProjectId(current =>
          current && ownedProjects.some(project => project.id === current)
            ? current
            : ownedProjects[0]?.id ?? null,
        )
      })
    return request.abort
  }, [authStatus, locale, user?.id])

  useEffect(() => {
    if (authStatus !== "authenticated" || !user) return
    if (!projectId) {
      setQuestionnaires([])
      setQuestionnaireId(null)
      return
    }
    const request = questionnaireListTrackerRef.current.begin()
    setResourceError(false)
    void request.run(signal => apiListQuestionnaires(locale, projectId, signal))
      .then(result => {
        if (result.status === "stale") return
        if (result.status === "error") {
          if (!(result.error instanceof DOMException && result.error.name === "AbortError")) setResourceError(true)
          return
        }
        const ownedQuestionnaires = result.value
        setQuestionnaires(ownedQuestionnaires)
        const selected = ownedQuestionnaires.find(item => item.id === questionnaireIdRef.current)
        setQuestionnaireId(selected?.id ?? ownedQuestionnaires[0]?.id ?? null)
        if (ownedQuestionnaires.length === 0) {
          setConfig(EMPTY_CONFIG)
          setSaveStatus("idle")
        }
      })
    return request.abort
  }, [authStatus, locale, projectId, user?.id])

  useEffect(() => {
    if (authStatus !== "authenticated" || !user || !questionnaireId) return
    const request = questionnaireLoadTrackerRef.current.begin()
    setResourceError(false)
    void request.run(signal => apiGetQuestionnaire(locale, questionnaireId, signal))
      .then(result => {
        if (result.status === "stale") return
        if (result.status === "error") {
          if (!(result.error instanceof DOMException && result.error.name === "AbortError")) setResourceError(true)
          return
        }
        if (questionnaireIdRef.current === result.value.id) {
          applyQuestionnaire(result.value)
        }
      })
    return request.abort
  }, [applyQuestionnaire, authStatus, locale, projectId, questionnaireId, user?.id])

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
          try {
            const serverDraft = await apiGetQuestionnaire(job.locale, job.resourceId)
            if (questionnaireIdRef.current === job.resourceId) {
              applyQuestionnaire(serverDraft)
            }
          } catch (reloadError) {
            if (
              questionnaireIdRef.current === job.resourceId &&
              !(reloadError instanceof DOMException && reloadError.name === "AbortError")
            ) {
              setSaveStatus("conflicted")
              setResourceError(true)
            }
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
    if (!currentRun || !shouldPollRound(currentRun.status)) return
    const controller = new AbortController()
    const polledRoundId = currentRun.id
    const timer = window.setInterval(async () => {
      try {
        const next = await apiFetchRound(locale, currentRun.id, controller.signal)
        setCurrentRun(current =>
          mergePolledRoundSnapshot(current, next, polledRoundId),
        )
        if (!shouldPollRound(next.status)) {
          window.clearInterval(timer)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const code = error instanceof SurveyApiError ? error.code : "SURVEY_API_ERROR"
          const message = messages.apiErrors[code as keyof typeof messages.apiErrors] ??
            messages.errors.polling
          setRunFeedback({ kind: "error", message })
          window.clearInterval(timer)
        }
      }
    }, 250)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [currentRun?.id, currentRun?.status, locale, messages.apiErrors, messages.errors.polling])

  const {
    round: displayRound,
    isRunning: displayIsRunning,
    activeRespondentId: displayActiveRespondentId,
    status: displayStatus,
  } = getRoundDisplayState(currentRun, viewingHistoryRound)
  const displaySessions = displayRound?.sessions ?? []
  const displayRespondents = displayRound?.respondents ?? []
  const displayProgress = displayRound?.progress ?? EMPTY_PROGRESS
  const displaySentiment = displayRound?.sentiment ?? EMPTY_SENTIMENT
  const displayQuestionAnalysis = displayRound?.questionAnalysis ?? []
  const displayDemographicAnalysis = displayRound?.demographicAnalysis ?? []
  const displayQuestions = displayRound?.config.questions ?? config.questions
  const displayConfig = displayRound?.config ?? config
  const displayResponses = displayRound?.responses ?? []
  const displayInferenceResults = displayRound?.inferenceResults ?? []
  const displayInferenceSummary = displayRound?.inferenceSummary ?? []

  const localizedApiError = useCallback((error: unknown) => {
    const code = error instanceof SurveyApiError ? error.code : "SURVEY_API_ERROR"
    return messages.apiErrors[code as keyof typeof messages.apiErrors] ??
      (error instanceof Error ? error.message : messages.apiErrors.SURVEY_API_ERROR)
  }, [messages.apiErrors])

  const runSimulation = useCallback(async () => {
    if (runDisabled || !questionnaireId) return

    setActiveWorkspace("results")
    setConfigSheetOpen(false)
    setViewingHistoryRound(null)
    setRunFeedback(null)

    try {
      setCurrentRun(await apiCreateRound(locale, questionnaireId))
    } catch (error) {
      setRunFeedback({ kind: "error", message: localizedApiError(error) })
    }
  }, [locale, localizedApiError, questionnaireId, runDisabled])

  const handleProjectChange = useCallback((nextProjectId: string) => {
    abortOutstandingSurveyRequests()
    roundResourceRequestGuardRef.current.invalidate()
    draftSaveQueueRef.current?.discardPendingExcept("")
    projectIdRef.current = nextProjectId
    questionnaireIdRef.current = null
    setProjectId(nextProjectId)
    setQuestionnaires([])
    setQuestionnaireId(null)
    setConfig(EMPTY_CONFIG)
    setSaveStatus("idle")
    setCurrentRun(null)
    setViewingHistoryRound(null)
    setRoundHistory([])
    setHistoryLoading(false)
    setHistoryError(null)
    setCopyingRoundId(null)
  }, [])

  const handleQuestionnaireChange = useCallback((nextQuestionnaireId: string) => {
    abortOutstandingSurveyRequests()
    roundResourceRequestGuardRef.current.invalidate()
    draftSaveQueueRef.current?.discardPendingExcept(nextQuestionnaireId)
    questionnaireIdRef.current = nextQuestionnaireId
    setQuestionnaireId(nextQuestionnaireId)
    setSaveStatus("idle")
    setCurrentRun(null)
    setViewingHistoryRound(null)
    setHistoryLoading(false)
    setHistoryError(null)
    setCopyingRoundId(null)
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

  const handleSelectRespondent = useCallback((id: string) => {
    setFocusedRespondentId(id)
    setActiveWorkspace("results")
    setAnalyticsSheetOpen(false)
  }, [])

  const loadRoundHistory = useCallback(async () => {
    if (!projectId) return
    setHistoryLoading(true)
    setHistoryError(null)
    const result = await roundResourceRequestGuardRef.current.run("list", () =>
      apiListProjectRounds(locale, projectId),
    )
    if (result.status === "stale") return
    if (result.status === "success") {
      setRoundHistory(result.value)
    } else if (!(result.error instanceof DOMException && result.error.name === "AbortError")) {
      setHistoryError(localizedApiError(result.error))
    }
    setHistoryLoading(false)
  }, [locale, localizedApiError, projectId])

  const handleSelectRound = useCallback(async (roundId: string) => {
    setHistoryError(null)
    const result = await roundResourceRequestGuardRef.current.run("detail", () =>
      apiFetchRound(locale, roundId),
    )
    if (result.status === "stale") return
    if (result.status === "success") {
      const snapshot = result.value
      setViewingHistoryRound(snapshot)
      setMode(snapshot.mode)
      setFocusedRespondentId(null)
      setActiveWorkspace("results")
    } else if (!(result.error instanceof DOMException && result.error.name === "AbortError")) {
      setHistoryError(localizedApiError(result.error))
    }
  }, [locale, localizedApiError])

  const handleCopyRound = useCallback(async (roundId: string) => {
    if (copyingRoundId) return
    setCopyingRoundId(roundId)
    setHistoryError(null)
    const result = await roundResourceRequestGuardRef.current.run("copy", () =>
      apiCopyRound(locale, roundId),
    )
    if (result.status === "stale") return
    if (result.status === "success") {
      const copied = result.value
      setQuestionnaires(current => [copied, ...current.filter(item => item.id !== copied.id)])
      applyQuestionnaire(copied)
      lockLocale()
    } else if (!(result.error instanceof DOMException && result.error.name === "AbortError")) {
      setHistoryError(localizedApiError(result.error))
    }
    setCopyingRoundId(null)
  }, [applyQuestionnaire, copyingRoundId, locale, localizedApiError, lockLocale])

  const handleRunAction = useCallback(async (action: RunAction) => {
    if (!displayRound || runMutationGuardRef.current.pendingAction() !== null) return
    setPendingRunAction(action)
    setRunFeedback(null)
    try {
      const next = await runMutationGuardRef.current.run(action, async () => {
        if (action === "pause") return apiPauseRound(locale, displayRound.id)
        if (action === "resume") return apiResumeRound(locale, displayRound.id)
        if (action === "cancel") return apiCancelRound(locale, displayRound.id)
        return apiRetryRound(
          locale,
          displayRound.id,
          action === "retry_failed" ? "failed" : "incomplete",
        )
      })
      if (!next) return
      setCurrentRun(next)
      setViewingHistoryRound(null)
      setMode(next.mode)
      setRoundHistory(current => [next, ...current.filter(item => item.id !== next.id)])
      setRunFeedback({ kind: "success", message: messages.rounds.actionSucceeded })
    } catch (error) {
      setRunFeedback({ kind: "error", message: localizedApiError(error) })
    } finally {
      setPendingRunAction(null)
    }
  }, [displayRound, locale, localizedApiError, messages.rounds.actionSucceeded])

  const configPanel = (
    <SurveyConfigPanel
      config={displayConfig}
      onConfigChange={viewingHistoryRound ? () => {} : setConfig}
      onStartSimulation={runSimulation}
      isRunning={displayIsRunning}
      runDisabled={runDisabled || Boolean(viewingHistoryRound)}
      mode={mode}
      readOnly={Boolean(viewingHistoryRound)}
    />
  )

  const resultsPanel =
    mode === "interview" ? (
      <ChatSimulationPanel
        sessions={displaySessions}
        respondents={displayRespondents}
        isRunning={displayIsRunning}
        currentRespondentId={displayActiveRespondentId}
        focusedRespondentId={focusedRespondentId}
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
        isRunning={displayIsRunning}
        focusedRespondentId={focusedRespondentId}
      />
    )

  const analyticsPanel = (
    <AnalyticsPanel
      mode={mode}
      progress={displayProgress}
      sentiment={displaySentiment}
      sessions={displaySessions}
      respondents={displayRespondents}
      questions={displayQuestions}
      questionAnalysis={displayQuestionAnalysis}
      demographicAnalysis={displayDemographicAnalysis}
      inferenceResults={displayInferenceResults}
      inferenceSummary={displayInferenceSummary}
      isRunning={displayIsRunning}
      roundId={displayRound?.id ?? null}
      onFocusRespondent={handleSelectRespondent}
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
                    displayStatus === "running"
                      ? "bg-emerald-400 animate-pulse" 
                      : displayStatus === "history"
                      ? "bg-amber-400"
                      : "bg-muted-foreground"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {displayStatus === "running"
                    ? messages.dashboard.running
                    : displayStatus === "history"
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
              <RoundHistoryDialog
                rounds={roundHistory}
                questionnaires={questionnaires}
                selectedRound={viewingHistoryRound}
                loading={historyLoading}
                error={historyError}
                copyingRoundId={copyingRoundId}
                onRefresh={() => void loadRoundHistory()}
                onSelectRound={roundId => void handleSelectRound(roundId)}
                onCopyRound={roundId => void handleCopyRound(roundId)}
              />
              {viewingHistoryRound && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setViewingHistoryRound(null)
                    setMode(
                      currentRun?.mode ??
                        questionnaires.find(item => item.id === questionnaireId)?.mode ??
                        mode,
                    )
                    setFocusedRespondentId(null)
                  }}
                >
                  {messages.analytics.returnToCurrent}
                </Button>
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

      <RunControlBar
        round={displayRound}
        pendingAction={pendingRunAction}
        feedback={runFeedback}
        onAction={action => void handleRunAction(action)}
      />

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
