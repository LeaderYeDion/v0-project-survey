"use client"

import { useState } from "react"
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
  Legend,
} from "recharts"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  BarChart3,
  Download,
  Users,
  MessageSquare,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PieChartIcon,
  Filter,
} from "lucide-react"
import type { 
  SurveyProgress, 
  SentimentData, 
  InterviewSession,
  RespondentProfile,
  QuestionAnalysis,
  DemographicAnalysis,
  SurveyQuestion
} from "@/lib/mock-survey-service"

interface AnalyticsPanelProps {
  progress: SurveyProgress
  sentiment: SentimentData
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  questions: SurveyQuestion[]
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  onExport: (format: "json" | "csv") => void
  isRunning: boolean
}

export function AnalyticsPanel({
  progress,
  sentiment,
  sessions,
  respondents,
  questions,
  questionAnalysis,
  demographicAnalysis,
  onExport,
  isRunning
}: AnalyticsPanelProps) {
  const [selectedQuestion, setSelectedQuestion] = useState<string>(questions[0]?.id || "")
  const [selectedDemographic, setSelectedDemographic] = useState<string>("city")

  const sentimentData = [
    { name: "正面", value: sentiment.positive, fill: "#10b981" },
    { name: "中性", value: sentiment.neutral, fill: "#64748b" },
    { name: "负面", value: sentiment.negative, fill: "#f43f5e" },
  ]

  // Status distribution
  const statusData = [
    { 
      name: "已完成", 
      value: sessions.filter(s => s.status === "completed").length,
      fill: "#10b981"
    },
    { 
      name: "受访者终止", 
      value: sessions.filter(s => s.status === "terminated_by_respondent").length,
      fill: "#f59e0b"
    },
    { 
      name: "调研方终止", 
      value: sessions.filter(s => s.status === "terminated_by_interviewer").length,
      fill: "#f43f5e"
    },
    { 
      name: "进行中", 
      value: sessions.filter(s => s.status === "in_progress").length,
      fill: "#3b82f6"
    },
    { 
      name: "等待中", 
      value: sessions.filter(s => s.status === "pending").length,
      fill: "#64748b"
    },
  ].filter(d => d.value > 0)

  // Get current question analysis
  const currentQuestionAnalysis = questionAnalysis.find(q => q.questionId === selectedQuestion)

  // Prepare chart data for selected question
  const questionResponseData = currentQuestionAnalysis 
    ? Object.entries(currentQuestionAnalysis.responseDistribution).map(([key, value]) => ({
        answer: key.length > 8 ? key.substring(0, 8) + "..." : key,
        fullAnswer: key,
        count: value
      }))
    : []

  // Filter demographic analysis for selected question and type
  const getDemographicData = () => {
    const filtered = demographicAnalysis.filter(d => 
      d.questionId === selectedQuestion
    )
    
    if (selectedDemographic === "city") {
      return filtered.filter(d => !d.tagName.startsWith("收入:"))
    } else {
      return filtered.filter(d => d.tagName.startsWith("收入:"))
    }
  }

  const demographicData = getDemographicData()

  const completionPercentage = progress.totalRespondents > 0
    ? Math.round((progress.completedRespondents / progress.totalRespondents) * 100)
    : 0

  const totalMessages = sessions.reduce((acc, s) => acc + s.dialog.length, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">分析面板</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("json")}
            disabled={sessions.length === 0}
            className="text-muted-foreground hover:text-foreground h-7 px-2"
          >
            <Download className="w-3 h-3 mr-1" />
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onExport("csv")}
            disabled={sessions.length === 0}
            className="text-muted-foreground hover:text-foreground h-7 px-2"
          >
            <Download className="w-3 h-3 mr-1" />
            CSV
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-5">
          {/* Quick Stats Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">总受访者</span>
              </div>
              <span className="text-2xl font-bold text-foreground">
                {progress.totalRespondents}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">已完成</span>
              </div>
              <span className="text-2xl font-bold text-emerald-400">
                {progress.completedRespondents}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <XCircle className="w-4 h-4 text-rose-400" />
                <span className="text-xs text-muted-foreground">终止</span>
              </div>
              <span className="text-2xl font-bold text-rose-400">
                {progress.terminatedRespondents}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="w-4 h-4 text-accent" />
                <span className="text-xs text-muted-foreground">总对话</span>
              </div>
              <span className="text-2xl font-bold text-foreground">
                {totalMessages}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                访谈完成率
              </span>
              <span className="text-foreground font-medium">{completionPercentage}%</span>
            </div>
            <Progress value={completionPercentage} className="h-2 bg-secondary" />
          </div>

          {/* Tabbed Analysis */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full bg-secondary/30 p-1">
              <TabsTrigger value="overview" className="flex-1 text-xs">概览</TabsTrigger>
              <TabsTrigger value="questions" className="flex-1 text-xs">问题分析</TabsTrigger>
              <TabsTrigger value="demographic" className="flex-1 text-xs">人群分析</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Sentiment Pie Chart */}
              <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                <h3 className="text-xs font-medium text-foreground mb-3 flex items-center gap-1.5">
                  <PieChartIcon className="w-3.5 h-3.5 text-primary" />
                  情感分布
                </h3>
                
                {sessions.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                    暂无数据
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ChartContainer
                      config={{
                        positive: { label: "正面", color: "#10b981" },
                        neutral: { label: "中性", color: "#64748b" },
                        negative: { label: "负面", color: "#f43f5e" },
                      }}
                      className="h-24 w-24"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={sentimentData}
                            cx="50%"
                            cy="50%"
                            innerRadius={20}
                            outerRadius={40}
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

                    <div className="flex-1 space-y-1.5">
                      {sentimentData.map((item) => (
                        <div key={item.name} className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: item.fill }}
                          />
                          <span className="text-xs text-muted-foreground flex-1">
                            {item.name}
                          </span>
                          <span className="text-xs font-medium text-foreground">
                            {item.value}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Status Distribution */}
              <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                <h3 className="text-xs font-medium text-foreground mb-3 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-primary" />
                  访谈状态分布
                </h3>
                
                {sessions.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                    暂无数据
                  </div>
                ) : (
                  <div className="space-y-2">
                    {statusData.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                        <span className="text-xs text-muted-foreground flex-1">
                          {item.name}
                        </span>
                        <span className="text-xs font-medium text-foreground">
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Questions Tab */}
            <TabsContent value="questions" className="mt-4 space-y-4">
              <Select value={selectedQuestion} onValueChange={setSelectedQuestion}>
                <SelectTrigger className="w-full h-8 text-xs bg-secondary/30 border-border/30">
                  <SelectValue placeholder="选择问题" />
                </SelectTrigger>
                <SelectContent>
                  {questions.map(q => (
                    <SelectItem key={q.id} value={q.id} className="text-xs">
                      {q.question.length > 30 ? q.question.substring(0, 30) + "..." : q.question}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {currentQuestionAnalysis && (
                <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium text-foreground">回答分布</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {currentQuestionAnalysis.totalResponses} 条回答
                    </Badge>
                  </div>

                  {currentQuestionAnalysis.averageScore !== undefined && (
                    <div className="mb-3 p-2 rounded-lg bg-primary/10 border border-primary/20">
                      <span className="text-xs text-muted-foreground">平均分: </span>
                      <span className="text-sm font-bold text-primary">
                        {currentQuestionAnalysis.averageScore.toFixed(1)}
                      </span>
                    </div>
                  )}
                  
                  {questionResponseData.length === 0 ? (
                    <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                      暂无回答数据
                    </div>
                  ) : (
                    <ChartContainer
                      config={{
                        count: { label: "回答数", color: "hsl(var(--primary))" },
                      }}
                      className="h-36"
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={questionResponseData} layout="vertical">
                          <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                          <YAxis 
                            dataKey="answer" 
                            type="category" 
                            width={60}
                            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                          />
                          <ChartTooltip 
                            content={({ payload }) => {
                              if (payload && payload[0]) {
                                const data = payload[0].payload
                                return (
                                  <div className="bg-card border border-border rounded-lg p-2 shadow-lg">
                                    <p className="text-xs text-foreground">{data.fullAnswer}</p>
                                    <p className="text-xs text-muted-foreground">数量: {data.count}</p>
                                  </div>
                                )
                              }
                              return null
                            }}
                          />
                          <Bar
                            dataKey="count"
                            fill="hsl(var(--primary))"
                            radius={[0, 4, 4, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Demographic Tab */}
            <TabsContent value="demographic" className="mt-4 space-y-4">
              <div className="flex gap-2">
                <Select value={selectedQuestion} onValueChange={setSelectedQuestion}>
                  <SelectTrigger className="flex-1 h-8 text-xs bg-secondary/30 border-border/30">
                    <SelectValue placeholder="选择问题" />
                  </SelectTrigger>
                  <SelectContent>
                    {questions.map(q => (
                      <SelectItem key={q.id} value={q.id} className="text-xs">
                        {q.question.length > 20 ? q.question.substring(0, 20) + "..." : q.question}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedDemographic} onValueChange={setSelectedDemographic}>
                  <SelectTrigger className="w-24 h-8 text-xs bg-secondary/30 border-border/30">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="city" className="text-xs">按城市</SelectItem>
                    <SelectItem value="income" className="text-xs">按收入</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                {demographicData.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs p-3 rounded-xl bg-secondary/20 border border-border/30">
                    暂无人群分析数据
                  </div>
                ) : (
                  demographicData.map((data, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          <Filter className="w-3 h-3 text-primary" />
                          {data.tagName}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {data.respondentCount} 人
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        {Object.entries(data.responseDistribution).map(([answer, count]) => (
                          <div key={answer} className="flex items-center gap-2">
                            <div className="flex-1 h-4 bg-secondary/50 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary/60 rounded-full"
                                style={{ 
                                  width: `${(count / data.respondentCount) * 100}%` 
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-20 truncate" title={answer}>
                              {answer}
                            </span>
                            <span className="text-[10px] font-medium text-foreground w-6 text-right">
                              {count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Status Indicator */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20">
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
                    ? `正在访谈第 ${progress.currentRespondentIndex + 1} 位受访者`
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
