"use client"

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  BarChart3,
  Download,
  Clock,
  Users,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
} from "lucide-react"
import type { SurveyProgress, SentimentData, ChatMessage } from "@/lib/mock-survey-service"

interface AnalyticsPanelProps {
  progress: SurveyProgress
  sentiment: SentimentData
  messages: ChatMessage[]
  onExport: (format: "json" | "csv") => void
  isRunning: boolean
}

export function AnalyticsPanel({
  progress,
  sentiment,
  messages,
  onExport,
  isRunning
}: AnalyticsPanelProps) {
  const sentimentData = [
    { name: "正面", value: sentiment.positive, fill: "#10b981" },
    { name: "中性", value: sentiment.neutral, fill: "#64748b" },
    { name: "负面", value: sentiment.negative, fill: "#f43f5e" },
  ]

  // Group messages by question for response distribution
  const questionResponses = messages.reduce((acc, msg) => {
    acc[msg.questionId] = (acc[msg.questionId] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const responseData = Object.entries(questionResponses).map(([id, count]) => ({
    question: id.replace("q", "Q"),
    responses: count,
  }))

  const completionPercentage = Math.round(
    (progress.completedAgents / progress.totalAgents) * 100
  )

  const questionProgress = Math.round(
    (progress.currentQuestion / progress.totalQuestions) * 100
  )

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">分析面板</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("json")}
            disabled={messages.length === 0}
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="w-4 h-4 mr-1" />
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("csv")}
            disabled={messages.length === 0}
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="w-4 h-4 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {/* Progress Stats Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">代理完成</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">
                  {progress.completedAgents}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {progress.totalAgents}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-accent" />
                <span className="text-xs text-muted-foreground">总响应数</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">
                  {messages.length}
                </span>
                <TrendingUp className="w-4 h-4 text-accent" />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">问题进度</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">
                  {progress.currentQuestion}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {progress.totalQuestions}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-xs text-muted-foreground">预计剩余</span>
              </div>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-foreground">
                  {formatTime(progress.estimatedTimeRemaining)}
                </span>
              </div>
            </div>
          </div>

          {/* Progress Bars */}
          <div className="space-y-4 p-4 rounded-xl bg-secondary/20 border border-border/30">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              进度概览
            </h3>
            
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">代理完成率</span>
                  <span className="text-foreground font-medium">{completionPercentage}%</span>
                </div>
                <Progress value={completionPercentage} className="h-2 bg-secondary" />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">问题完成率</span>
                  <span className="text-foreground font-medium">{questionProgress}%</span>
                </div>
                <Progress value={questionProgress} className="h-2 bg-secondary" />
              </div>
            </div>
          </div>

          {/* Sentiment Pie Chart */}
          <div className="p-4 rounded-xl bg-secondary/20 border border-border/30">
            <h3 className="text-sm font-medium text-foreground mb-4">情感分布</h3>
            
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                暂无数据
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ChartContainer
                  config={{
                    positive: { label: "正面", color: "#10b981" },
                    neutral: { label: "中性", color: "#64748b" },
                    negative: { label: "负面", color: "#f43f5e" },
                  }}
                  className="h-32 w-32"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={25}
                        outerRadius={50}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {sentimentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>

                <div className="flex-1 space-y-2">
                  {sentimentData.map((item) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-xs text-muted-foreground flex-1">
                        {item.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-xs bg-secondary/50 text-foreground"
                      >
                        {item.value}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Response Distribution Bar Chart */}
          <div className="p-4 rounded-xl bg-secondary/20 border border-border/30">
            <h3 className="text-sm font-medium text-foreground mb-4">问题响应分布</h3>
            
            {responseData.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                暂无数据
              </div>
            ) : (
              <ChartContainer
                config={{
                  responses: { label: "响应数", color: "hsl(var(--primary))" },
                }}
                className="h-40"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={responseData}>
                    <XAxis
                      dataKey="question"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="responses"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>

          {/* Status Indicator */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  isRunning ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"
                }`}
              />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isRunning ? "模拟进行中" : "等待开始"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isRunning
                    ? `正在收集第 ${progress.currentQuestion} 个问题的响应`
                    : "配置参数后点击开始模拟"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
