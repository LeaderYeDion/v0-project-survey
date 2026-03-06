"use client"

import { useState, useCallback, useRef } from "react"
import { SurveyConfigPanel } from "@/components/survey-config-panel"
import { ChatSimulationPanel } from "@/components/chat-simulation-panel"
import { AnalyticsPanel } from "@/components/analytics-panel"
import { Sparkles, Cpu } from "lucide-react"
import {
  defaultSurveyConfig,
  startSurveySimulation,
  generateAgentResponse,
  analyzeSentiment,
  exportSurveyResults,
  type SurveyConfig,
  type ChatMessage,
  type VirtualAgent,
  type SurveyProgress,
  type SentimentData,
} from "@/lib/mock-survey-service"

export default function ResearcherDashboard() {
  const [config, setConfig] = useState<SurveyConfig>(defaultSurveyConfig)
  const [isRunning, setIsRunning] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [agents, setAgents] = useState<VirtualAgent[]>([])
  const [currentQuestion, setCurrentQuestion] = useState("")
  const [progress, setProgress] = useState<SurveyProgress>({
    totalAgents: 0,
    completedAgents: 0,
    currentQuestion: 0,
    totalQuestions: 0,
    estimatedTimeRemaining: 0,
  })
  const [sentiment, setSentiment] = useState<SentimentData>({
    positive: 0,
    neutral: 0,
    negative: 0,
  })

  const abortRef = useRef(false)

  const runSimulation = useCallback(async () => {
    if (isRunning) return

    setIsRunning(true)
    setMessages([])
    abortRef.current = false

    try {
      // Start simulation and get agents
      const { agents: simulationAgents } = await startSurveySimulation(config)
      setAgents(simulationAgents)

      setProgress({
        totalAgents: simulationAgents.length,
        completedAgents: 0,
        currentQuestion: 0,
        totalQuestions: config.questions.length,
        estimatedTimeRemaining: config.questions.length * simulationAgents.length * 2,
      })

      const allMessages: ChatMessage[] = []

      // Process each question
      for (let qIndex = 0; qIndex < config.questions.length; qIndex++) {
        if (abortRef.current) break

        const question = config.questions[qIndex]
        setCurrentQuestion(question.question)
        setProgress((prev) => ({
          ...prev,
          currentQuestion: qIndex + 1,
          estimatedTimeRemaining: (config.questions.length - qIndex) * simulationAgents.length * 2,
        }))

        // Collect responses from each agent (with some randomization in order)
        const shuffledAgents = [...simulationAgents].sort(() => Math.random() - 0.5)

        for (let aIndex = 0; aIndex < shuffledAgents.length; aIndex++) {
          if (abortRef.current) break

          const agent = shuffledAgents[aIndex]

          // Generate response
          const response = await generateAgentResponse(agent, question)
          allMessages.push(response)

          setMessages([...allMessages])
          setSentiment(analyzeSentiment(allMessages))

          setProgress((prev) => ({
            ...prev,
            completedAgents: Math.floor(
              ((qIndex * simulationAgents.length + aIndex + 1) /
                (config.questions.length * simulationAgents.length)) *
                simulationAgents.length
            ),
            estimatedTimeRemaining: Math.max(
              0,
              prev.estimatedTimeRemaining - 2
            ),
          }))
        }
      }

      setProgress((prev) => ({
        ...prev,
        completedAgents: simulationAgents.length,
        currentQuestion: config.questions.length,
        estimatedTimeRemaining: 0,
      }))
    } catch (error) {
      console.error("[v0] Simulation error:", error)
    } finally {
      setIsRunning(false)
      setCurrentQuestion("")
    }
  }, [config, isRunning])

  const handleExport = useCallback(
    async (format: "json" | "csv") => {
      try {
        const blob = await exportSurveyResults("current-session", format)
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
    []
  )

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
            messages={messages}
            agents={agents}
            isRunning={isRunning}
            currentQuestion={currentQuestion}
          />
        </div>

        {/* Right Column - Analytics */}
        <div className="w-[320px] flex-shrink-0 border-l border-border/50 bg-card/30 backdrop-blur-xl">
          <AnalyticsPanel
            progress={progress}
            sentiment={sentiment}
            messages={messages}
            onExport={handleExport}
            isRunning={isRunning}
          />
        </div>
      </main>
    </div>
  )
}
