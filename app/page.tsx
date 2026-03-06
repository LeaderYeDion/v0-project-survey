"use client"

import { useState, useCallback, useRef } from "react"
import { SurveyConfigPanel } from "@/components/survey-config-panel"
import { ChatSimulationPanel } from "@/components/chat-simulation-panel"
import { AnalyticsPanel } from "@/components/analytics-panel"
import { Sparkles, Cpu } from "lucide-react"
import {
  defaultSurveyConfig,
  fetchRespondentList,
  askQuestion,
  shouldInterviewerTerminate,
  analyzeSentiment,
  analyzeQuestionResponses,
  analyzeByDemographics,
  exportSurveyResults,
  type SurveyConfig,
  type InterviewSession,
  type RespondentProfile,
  type SurveyProgress,
  type SentimentData,
  type DialogMessage,
  type QuestionAnalysis,
  type DemographicAnalysis,
} from "@/lib/mock-survey-service"

export default function ResearcherDashboard() {
  const [config, setConfig] = useState<SurveyConfig>(defaultSurveyConfig)
  const [isRunning, setIsRunning] = useState(false)
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [respondents, setRespondents] = useState<RespondentProfile[]>([])
  const [currentRespondentId, setCurrentRespondentId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SurveyProgress>({
    totalRespondents: 0,
    completedRespondents: 0,
    inProgressRespondents: 0,
    terminatedRespondents: 0,
    currentRespondentIndex: 0,
  })
  const [sentiment, setSentiment] = useState<SentimentData>({
    positive: 0,
    neutral: 0,
    negative: 0,
  })
  const [questionAnalysis, setQuestionAnalysis] = useState<QuestionAnalysis[]>([])
  const [demographicAnalysis, setDemographicAnalysis] = useState<DemographicAnalysis[]>([])

  const abortRef = useRef(false)

  const runSimulation = useCallback(async () => {
    if (isRunning) return

    setIsRunning(true)
    setSessions([])
    setQuestionAnalysis([])
    setDemographicAnalysis([])
    abortRef.current = false

    try {
      // Fetch respondent list from "backend"
      const fetchedRespondents = await fetchRespondentList(config.agentCount)
      setRespondents(fetchedRespondents)

      // Initialize sessions for all respondents
      const initialSessions: InterviewSession[] = fetchedRespondents.map(r => ({
        respondentId: r.id,
        status: "pending",
        dialog: [],
        completedQuestions: 0,
        totalQuestions: config.questions.length,
      }))
      setSessions(initialSessions)

      setProgress({
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
        setCurrentRespondentId(respondent.id)

        // Update session status to in_progress
        setSessions(prev => prev.map(s => 
          s.respondentId === respondent.id 
            ? { ...s, status: "in_progress", startTime: new Date() }
            : s
        ))

        setProgress(prev => ({
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
          setSessions(prev => prev.map(s => 
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
          setSessions(prev => {
            const updated = prev.map(s => 
              s.respondentId === respondent.id 
                ? { 
                    ...s, 
                    dialog: [...dialog],
                    completedQuestions: qIndex + 1,
                  }
                : s
            )
            // Update analytics
            setSentiment(analyzeSentiment(updated))
            setQuestionAnalysis(analyzeQuestionResponses(updated, config.questions))
            setDemographicAnalysis(analyzeByDemographics(updated, fetchedRespondents, config.questions))
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
        const finalStatus = terminated 
          ? (terminationReason?.includes("受访者") ? "terminated_by_respondent" : "terminated_by_interviewer")
          : "completed"

        setSessions(prev => {
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
          // Final analytics update for this respondent
          setSentiment(analyzeSentiment(updated))
          setQuestionAnalysis(analyzeQuestionResponses(updated, config.questions))
          setDemographicAnalysis(analyzeByDemographics(updated, fetchedRespondents, config.questions))
          return updated
        })

        // Update progress
        setProgress(prev => ({
          ...prev,
          completedRespondents: terminated ? prev.completedRespondents : prev.completedRespondents + 1,
          terminatedRespondents: terminated ? prev.terminatedRespondents + 1 : prev.terminatedRespondents,
          inProgressRespondents: 0,
        }))
      }

    } catch (error) {
      console.error("[v0] Simulation error:", error)
    } finally {
      setIsRunning(false)
      setCurrentRespondentId(null)
    }
  }, [config, isRunning])

  const handleExport = useCallback(
    async (format: "json" | "csv") => {
      try {
        const blob = await exportSurveyResults(sessions, respondents, format)
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `survey-results.${format}`
        a.click()
        URL.revokeObjectURL(url)
      } catch (error) {
        console.error("[v0] Export error:", error)
      }
    },
    [sessions, respondents]
  )

  const handleSelectRespondent = useCallback((id: string) => {
    // This could be used for additional actions when selecting a respondent
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
                  AI 驱动的虚拟调研代理模拟平台
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/50">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isRunning ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {isRunning ? "运行中" : "待机"}
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
          />
        </div>

        {/* Middle Column - Chat Simulation */}
        <div className="flex-1 bg-gradient-to-b from-background to-card/20 backdrop-blur-xl">
          <ChatSimulationPanel
            sessions={sessions}
            respondents={respondents}
            isRunning={isRunning}
            currentRespondentId={currentRespondentId}
            onSelectRespondent={handleSelectRespondent}
          />
        </div>

        {/* Right Column - Analytics */}
        <div className="w-[340px] flex-shrink-0 border-l border-border/50 bg-card/30 backdrop-blur-xl">
          <AnalyticsPanel
            progress={progress}
            sentiment={sentiment}
            sessions={sessions}
            respondents={respondents}
            questions={config.questions}
            questionAnalysis={questionAnalysis}
            demographicAnalysis={demographicAnalysis}
            onExport={handleExport}
            isRunning={isRunning}
          />
        </div>
      </main>
    </div>
  )
}
