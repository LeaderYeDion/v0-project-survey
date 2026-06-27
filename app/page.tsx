"use client"

import { useState, useCallback, useRef } from "react"
import { SurveyConfigPanel } from "@/components/survey-config-panel"
import { ChatSimulationPanel } from "@/components/chat-simulation-panel"
import { AnalyticsPanel } from "@/components/analytics-panel"
import { BulkSurveyPanel } from "@/components/bulk-survey-panel"
import { Sparkles, Cpu } from "lucide-react"
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
import {
  apiGenerateRespondentsFromConfig,
  apiExportSurveyResults,
  apiBuildSurveyResponses,
} from "@/lib/survey-api"

type SimulationMode = "interview" | "survey"

export default function ResearcherDashboard() {
  const [config, setConfig] = useState<SurveyConfig>(defaultSurveyConfig)
  const [isRunning, setIsRunning] = useState(false)
  const [mode, setMode] = useState<SimulationMode>("survey")
  const [modeSelected, setModeSelected] = useState(false)
  
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

  return (
    <div className="min-h-screen bg-background">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-primary/3 to-transparent rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-border/50 backdrop-blur-xl bg-background/80">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <Cpu className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  Survey Agent Simulator
                  <Sparkles className="w-4 h-4 text-primary" />
                </h1>
                <p className="text-xs text-muted-foreground">
                  {mode === "interview"
                    ? "AI 驱动的虚拟访谈模拟平台"
                    : "AI 驱动的大规模问卷调研模拟平台"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center text-xs rounded-full bg-secondary/40 border border-border/60 p-0.5">
                <button
                  type="button"
                  className={`px-3 py-1 rounded-full transition text-[11px] ${
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
                  className={`px-3 py-1 rounded-full transition text-[11px] ${
                    mode === "survey"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                  onClick={() => setMode("survey")}
                >
                  问卷模式
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/50">
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
      </header>

      {/* Main Content - 3 Column Layout */}
      <main className="relative z-10 flex h-[calc(100vh-73px)]">
        {/* Left Column - Config Panel */}
        <div className="w-[340px] flex-shrink-0 border-r border-border/50 bg-card/30 backdrop-blur-xl">
          <SurveyConfigPanel
            config={config}
            onConfigChange={setConfig}
            onStartSimulation={runSimulation}
            isRunning={isRunning}
            mode={mode}
          />
        </div>

        {/* Middle Column - Simulation / Bulk Survey */}
        <div className="flex-1 bg-gradient-to-b from-background to-card/20 backdrop-blur-xl">
          {mode === "interview" ? (
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
          )}
        </div>

        {/* Right Column - Analytics */}
        <div className="w-[340px] flex-shrink-0 border-l border-border/50 bg-card/30 backdrop-blur-xl">
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
        </div>
      </main>

      {!modeSelected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-xl">
          <div className="w-[380px] rounded-2xl border border-border/70 bg-card/90 p-6 shadow-2xl">
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
