"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  ChartContainer,
  ChartTooltip,
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
  Save,
  History,
  ArrowLeft,
  Clock,
  Hash,
} from "lucide-react"
import type { 
  SurveyProgress, 
  SentimentData, 
  InterviewSession,
  RespondentProfile,
  QuestionAnalysis,
  DemographicAnalysis,
  SurveyQuestion,
  SurveyHistoryRecord,
  SurveyConfig,
} from "@/lib/survey-api"
import {
  analyzeQuestionResponses,
  apiSaveSurveyToHistory,
  apiFetchSurveyHistory,
  filterRespondentsByDimensions,
  getDimensionMetadata,
  groupRespondentsByDimensions,
  type DimensionFilters,
  type DimensionMetadata,
  type RespondentDimensionKey,
} from "@/lib/survey-api"

type ResponseDistributionEntry = {
  answer: string
  fullAnswer: string
  count: number
}

const AXIS_TICK_STYLE = {
  fill: "hsl(var(--muted-foreground))",
  fontSize: 9,
} as const

function calculateChartHeight(optionCount: number) {
  const rows = Math.max(optionCount, 1)
  const height = rows * 34 + 70
  return Math.min(700, Math.max(260, height))
}

function mapResponseDistributionEntries(
  distribution: Record<string, number>,
): ResponseDistributionEntry[] {
  return Object.entries(distribution).map(([key, value]) => ({
    answer: key.length > 8 ? `${key.substring(0, 8)}...` : key,
    fullAnswer: key,
    count: value,
  }))
}

function renderResponseTooltipContent(payload?: any[]) {
  const entry = payload?.[0]
  const data = entry?.payload
  if (!data) {
    return null
  }
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-lg">
      <p className="text-xs text-foreground break-words">{data.fullAnswer}</p>
      <p className="text-xs text-muted-foreground">数量: {data.count}</p>
    </div>
  )
}

function renderQuestionBarChart(data: ResponseDistributionEntry[], color: string) {
  const height = calculateChartHeight(data.length)
  return (
    <ChartContainer
      config={{
        count: {
          label: "回答数",
          color,
        },
      }}
      className="w-full"
      style={{ height, paddingBottom: 36, aspectRatio: "auto" }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 6, bottom: 6 }}>
          <XAxis
            type="number"
            domain={[0, "dataMax"]}
            allowDecimals={false}
            tick={AXIS_TICK_STYLE}
            tickFormatter={value => {
              const normalized = typeof value === "number" ? value : Number(value)
              return Number.isFinite(normalized) ? normalized.toString() : ""
            }}
            label={{
              value: "回答数",
              position: "bottom",
              offset: 10,
              fill: "hsl(var(--muted-foreground))",
              fontSize: 10,
            }}
          />
          <YAxis
            dataKey="answer"
            type="category"
            width={66}
            tick={AXIS_TICK_STYLE}
          />
          <ChartTooltip content={({ payload }) => renderResponseTooltipContent(payload)} />
          <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

interface AnalyticsPanelProps {
  progress: SurveyProgress
  sentiment: SentimentData
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  questions: SurveyQuestion[]
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  config: SurveyConfig
  onExport: (format: "json" | "csv") => void
  isRunning: boolean
  onLoadHistory: (record: SurveyHistoryRecord) => void
  onReturnToCurrent: () => void
  viewingHistoryRecord: SurveyHistoryRecord | null
}

export function AnalyticsPanel({
  progress,
  sentiment,
  sessions,
  respondents,
  questions,
  questionAnalysis,
  demographicAnalysis,
  config,
  onExport,
  isRunning,
  onLoadHistory,
  onReturnToCurrent,
  viewingHistoryRecord,
}: AnalyticsPanelProps) {
  const [selectedQuestion, setSelectedQuestion] = useState<string>(questions[0]?.id || "")
  const [selectedDemographic, setSelectedDemographic] = useState<string>("city")
  const [historyRecords, setHistoryRecords] = useState<SurveyHistoryRecord[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [dimensionFilters, setDimensionFilters] = useState<DimensionFilters>({})
  const [groupByDimensions, setGroupByDimensions] = useState<RespondentDimensionKey[]>([])

  const dimensionMetadata = useMemo(
    () => getDimensionMetadata(respondents, config.respondentConfigs),
    [respondents, config.respondentConfigs],
  )
  const dimensionMetadataMap = useMemo(() => {
    const map = new Map<RespondentDimensionKey, DimensionMetadata>()
    dimensionMetadata.forEach(meta => map.set(meta.key, meta))
    return map
  }, [dimensionMetadata])

  useEffect(() => {
    setDimensionFilters({})
    setGroupByDimensions([])
  }, [respondents, config.respondentConfigs])

  const CLEAR_DIMENSION_VALUE = "__ALL__"

  const handleDimensionFilterChange = useCallback(
    (key: RespondentDimensionKey, value: string) => {
      setDimensionFilters(prev => {
        const next = { ...prev }
        if (value && value !== CLEAR_DIMENSION_VALUE) {
          next[key] = value
        } else {
          delete next[key]
        }
        return next
      })
    },
    [],
  )

  const toggleGroupByDimension = useCallback((key: RespondentDimensionKey) => {
    setGroupByDimensions(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key],
    )
  }, [])

  const filteredRespondents = useMemo(
    () =>
      filterRespondentsByDimensions(respondents, config.respondentConfigs, dimensionFilters),
    [respondents, config.respondentConfigs, dimensionFilters],
  )

  const filteredSessions = useMemo(() => {
    const respondentIds = new Set(filteredRespondents.map(r => r.id))
    return sessions.filter(session => respondentIds.has(session.respondentId))
  }, [sessions, filteredRespondents])

  const filteredQuestionAnalysis = useMemo(
    () => analyzeQuestionResponses(filteredSessions, questions),
    [filteredSessions, questions],
  )
  const filteredQuestionAnalysisForSelected = filteredQuestionAnalysis.find(
    q => q.questionId === selectedQuestion,
  )

  const groupedRespondents = useMemo(
    () =>
      groupRespondentsByDimensions(filteredRespondents, config.respondentConfigs, groupByDimensions),
    [filteredRespondents, config.respondentConfigs, groupByDimensions],
  )

  const groupedQuestionSummaries = useMemo(() => {
    if (groupByDimensions.length === 0) {
      return []
    }

    return groupedRespondents.map(group => {
      const respondentSet = new Set(group.respondentIds)
      const groupSessions = filteredSessions.filter(session =>
        respondentSet.has(session.respondentId),
      )
      const groupAnalysis = analyzeQuestionResponses(groupSessions, questions).find(
        q => q.questionId === selectedQuestion,
      )
      const responseData = groupAnalysis
        ? mapResponseDistributionEntries(groupAnalysis.responseDistribution)
        : []

      return {
        label: group.label,
        respondentCount: group.respondentIds.length,
        totalResponses: groupAnalysis?.totalResponses ?? 0,
        responseData,
      }
    })
  }, [
    groupByDimensions,
    groupedRespondents,
    filteredSessions,
    questions,
    selectedQuestion,
  ])

  const hasActiveFilters = Object.values(dimensionFilters).some(value => !!value)
  const activeFilterEntries = (Object.entries(dimensionFilters) as [
    RespondentDimensionKey,
    string,
  ][]).filter(([, value]) => !!value)
  const groupByDescription = groupByDimensions
    .map(key => dimensionMetadataMap.get(key)?.label ?? key)
    .join(" • ")

  useEffect(() => {
    if (questions.length > 0 && !selectedQuestion) {
      setSelectedQuestion(questions[0].id)
    }
  }, [questions, selectedQuestion])

  const loadHistoryList = async () => {
    setIsLoadingHistory(true)
    try {
      const records = await apiFetchSurveyHistory()
      setHistoryRecords(records)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const handleSave = async () => {
    if (sessions.length === 0) return
    setIsSaving(true)
    try {
      await apiSaveSurveyToHistory({
        config,
        sessions,
        respondents,
        progress,
        sentiment,
        questionAnalysis,
        demographicAnalysis,
      })
      await loadHistoryList()
    } finally {
      setIsSaving(false)
    }
  }

  const handleSelectHistory = (record: SurveyHistoryRecord) => {
    onLoadHistory(record)
    setHistoryDialogOpen(false)
  }

  const sentimentData = [
    { name: "正面", value: sentiment.positive, fill: "#10b981" },
    { name: "中性", value: sentiment.neutral, fill: "#64748b" },
    { name: "负面", value: sentiment.negative, fill: "#f43f5e" },
  ]

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

  const globalQuestionAnalysis = questionAnalysis.find(q => q.questionId === selectedQuestion)

  const globalQuestionResponseData = globalQuestionAnalysis
    ? mapResponseDistributionEntries(globalQuestionAnalysis.responseDistribution)
    : []

  const filteredResponseData = filteredQuestionAnalysisForSelected
    ? mapResponseDistributionEntries(filteredQuestionAnalysisForSelected.responseDistribution)
    : []

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

  const formatDate = (date: Date) => {
    const d = new Date(date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col p-4 border-b border-border/50">
        <div className="flex items-center justify-between">
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
        
        {/* History info when viewing historical data */}
        {viewingHistoryRecord && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{formatDate(viewingHistoryRecord.savedAt)}</span>
            <Hash className="w-3 h-3 ml-2" />
            <span className="font-mono">{viewingHistoryRecord.id.slice(-8)}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-4 py-2 border-b border-border/50 flex gap-2">
        {viewingHistoryRecord ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onReturnToCurrent}
            className="flex-1 h-8 text-xs bg-secondary/30 border-border/50 hover:bg-secondary/50"
          >
            <ArrowLeft className="w-3 h-3 mr-1" />
            返回当前调研
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={sessions.length === 0 || isSaving || isRunning}
            className="flex-1 h-8 text-xs bg-primary/10 border-primary/30 hover:bg-primary/20 text-primary"
          >
            {isSaving ? (
              <div className="w-3 h-3 mr-1 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            ) : (
              <Save className="w-3 h-3 mr-1" />
            )}
            保存本次调研
          </Button>
        )}
        
        <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHistoryList}
              className="flex-1 h-8 text-xs bg-secondary/30 border-border/50 hover:bg-secondary/50"
            >
              <History className="w-3 h-3 mr-1" />
              历史记录
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                调研历史记录
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : historyRecords.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  暂无历史记录
                </div>
              ) : (
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-2">
                    {historyRecords.map((record) => (
                      <button
                        key={record.id}
                        onClick={() => handleSelectHistory(record)}
                        className="w-full p-3 rounded-lg bg-secondary/30 border border-border/30 hover:border-primary/50 hover:bg-secondary/50 transition-all text-left"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-foreground">
                            {record.config.title}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {record.respondents.length} 人
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(record.savedAt)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Hash className="w-3 h-3" />
                            {record.id.slice(-8)}
                          </span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-0">
                            完成 {record.progress.completedRespondents}
                          </Badge>
                          <Badge className="text-[10px] bg-rose-500/20 text-rose-400 border-0">
                            终止 {record.progress.terminatedRespondents}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {dimensionMetadata.map(meta => (
                      <div key={meta.key} className="space-y-1 text-[11px]">
                        <span className="text-muted-foreground">{meta.label}</span>
                        <Select
                          value={dimensionFilters[meta.key] ?? CLEAR_DIMENSION_VALUE}
                          onValueChange={value => handleDimensionFilterChange(meta.key, value)}
                        >
                          <SelectTrigger className="h-9 text-xs bg-background/50 border-border/50">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={CLEAR_DIMENSION_VALUE} className="text-xs">
                              全部
                            </SelectItem>
                            {meta.values.map(option => (
                              <SelectItem key={option} value={option} className="text-xs">
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      展示 {filteredRespondents.length} / {respondents.length} 位受访者
                    </span>
                    {activeFilterEntries.map(([key, value]) => (
                      <Badge key={`${key}-${value}`} variant="outline" className="text-[10px]">
                        {dimensionMetadataMap.get(key)?.label ?? key}: {value}
                      </Badge>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setDimensionFilters({})}
                      disabled={!hasActiveFilters}
                    >
                      清除筛选
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dimensionMetadata.map(meta => {
                      const isActive = groupByDimensions.includes(meta.key)
                      return (
                        <Button
                          key={meta.key}
                          size="sm"
                          variant={isActive ? "secondary" : "ghost"}
                          onClick={() => toggleGroupByDimension(meta.key)}
                          className="h-7 px-2 text-[11px]"
                        >
                          {isActive ? `取消按 ${meta.label} 分组` : `按 ${meta.label} 分组`}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {globalQuestionAnalysis ? (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium text-foreground">回答分布</h3>
                      <Badge variant="outline" className="text-[10px]">
                        {globalQuestionAnalysis.totalResponses} 条回答
                      </Badge>
                    </div>

                    {globalQuestionAnalysis.averageScore !== undefined && (
                      <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 text-[11px] text-muted-foreground">
                        平均分{" "}
                        <span className="text-sm font-bold text-primary">
                          {globalQuestionAnalysis.averageScore.toFixed(1)}
                        </span>
                      </div>
                    )}

                    {globalQuestionResponseData.length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                        暂无回答
                      </div>
                    ) : (
                      <>
                        {renderQuestionBarChart(globalQuestionResponseData, "#38bdf8")}
                        <p className="text-[10px] text-muted-foreground">
                          横轴：回答数；纵轴：选项内容
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 text-xs text-muted-foreground">
                    暂无问题数据
                  </div>
                )}

                {hasActiveFilters && (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium text-foreground">筛选洞察</h3>
                      <Badge variant="outline" className="text-[10px]">
                        {filteredRespondents.length} 位受访者
                      </Badge>
                    </div>
                    {filteredResponseData.length > 0 ? (
                      <>
                        {renderQuestionBarChart(filteredResponseData, "#f97316")}
                        <p className="text-[10px] text-muted-foreground">
                          横轴：回答数；纵轴：选项内容
                        </p>
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">
                        当前筛选下暂无回答
                      </div>
                    )}
                  </div>
                )}

                {groupedQuestionSummaries.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        按 {groupByDescription || "所选维度"} 分组
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {groupedQuestionSummaries.length} 个分组
                      </Badge>
                    </div>
                    <div className="space-y-3">
                      {groupedQuestionSummaries.map((group, idx) => (
                        <div
                          key={group.label + "-" + idx}
                          className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-foreground">{group.label}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {group.respondentCount} 位
                            </Badge>
                          </div>
                           {group.responseData.length === 0 ? (
                             <div className="text-[11px] text-muted-foreground">
                               当前维度组合暂无回答
                             </div>
                           ) : (
                             renderQuestionBarChart(group.responseData, "#a855f7")
                           )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  组合图表同样遵循横轴为回答数、纵轴为选项的约定。
                </p>
              </div>
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
                  isRunning
                    ? "bg-emerald-400 animate-pulse"
                    : viewingHistoryRecord
                    ? "bg-amber-400"
                    : sessions.length > 0
                    ? "bg-primary"
                    : "bg-muted-foreground"
                }`}
              />
              <span className="text-xs text-foreground">
                {isRunning
                  ? "正在进行调研..."
                  : viewingHistoryRecord
                  ? "正在查看历史记录"
                  : sessions.length > 0
                  ? "调研已完成"
                  : "等待开始调研"}
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
