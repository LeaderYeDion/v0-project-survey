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
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import {
  BarChart3,
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
  SurveyQuestion,
  AnalyticsQueryResult,
  DimensionFilters,
  DimensionMetadata,
  InferenceResult,
  InferenceSummaryItem,
  RespondentDimensionKey,
  SimulationMode,
} from "@/lib/survey-api"
import { useI18n } from "@/components/locale-provider"
import {
  formatDate,
  formatDecimal,
  formatInteger,
  formatPercentage,
  type Locale,
} from "@/lib/i18n/locale"
import type { MessageCatalog } from "@/lib/i18n/messages"
import { selectValidQuestionId } from "@/lib/question-selection"
import {
  createAnalyticsQueryKey,
  createAnalyticsSourceKey,
} from "@/lib/analytics-query-key"
import { apiQueryRunAnalytics, renderInferenceValue } from "@/lib/survey-api"
import { AnalysisScopeSummary } from "@/components/analysis-scope-summary"
import { ExceptionDrilldown } from "@/components/exception-drilldown"
import { ExportDialog } from "@/components/export-dialog"

type ResponseDistributionEntry = {
  answer: string
  fullAnswer: string
  count: number
}

type KeyedAnalyticsResult = {
  key: string
  result: AnalyticsQueryResult
}

type SourceDimensionMetadata = {
  sourceKey: string
  items: DimensionMetadata[]
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

function renderResponseTooltipContent(
  locale: Locale,
  messages: MessageCatalog,
  payload?: any[],
) {
  const entry = payload?.[0]
  const data = entry?.payload
  if (!data) {
    return null
  }
  return (
    <div className="bg-card border border-border rounded-lg p-2 shadow-lg">
      <p className="text-xs text-foreground break-words">{data.fullAnswer}</p>
      <p className="text-xs text-muted-foreground">
        {messages.analytics.quantity}: {formatInteger(locale, data.count)}
      </p>
    </div>
  )
}

function renderQuestionBarChart(
  data: ResponseDistributionEntry[],
  color: string,
  locale: Locale,
  messages: MessageCatalog,
) {
  const height = calculateChartHeight(data.length)
  return (
    <ChartContainer
      config={{
        count: {
          label: messages.analytics.answerCount,
          color,
        },
      }}
      className="w-full"
      style={{ height, paddingBottom: 36, aspectRatio: "auto" }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 6, bottom: 6 }}>
        <XAxis
          type="number"
          domain={[0, "dataMax"]}
          allowDecimals={false}
          tick={AXIS_TICK_STYLE}
          tickFormatter={value => {
            const normalized = typeof value === "number" ? value : Number(value)
            return Number.isFinite(normalized)
              ? formatInteger(locale, normalized)
              : ""
          }}
          label={{
            value: messages.analytics.answerCount,
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
        <ChartTooltip
          content={({ payload }) =>
            renderResponseTooltipContent(locale, messages, payload)
          }
        />
        <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

interface AnalyticsPanelProps {
  mode: SimulationMode
  progress: SurveyProgress
  sentiment: SentimentData
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  questions: SurveyQuestion[]
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  inferenceResults: InferenceResult[]
  inferenceSummary: InferenceSummaryItem[]
  isRunning: boolean
  roundId: string | null
  onFocusRespondent: (respondentId: string) => void
}

export function AnalyticsPanel({
  mode,
  progress,
  sentiment,
  sessions,
  respondents,
  questions,
  questionAnalysis,
  demographicAnalysis,
  inferenceResults,
  inferenceSummary,
  isRunning,
  roundId,
  onFocusRespondent,
}: AnalyticsPanelProps) {
  const { locale, messages } = useI18n()
  const [selectedQuestion, setSelectedQuestion] = useState<string>(() =>
    selectValidQuestionId("", questions),
  )
  const [selectedDemographic, setSelectedDemographic] = useState<string>("city")
  const [dimensionFilters, setDimensionFilters] = useState<DimensionFilters>({})
  const [groupByDimensions, setGroupByDimensions] = useState<RespondentDimensionKey[]>([])
  const [analyticsResultState, setAnalyticsResultState] =
    useState<KeyedAnalyticsResult | null>(null)
  const [dimensionMetadataState, setDimensionMetadataState] = useState<SourceDimensionMetadata | null>(null)
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false)
  const [analyticsError, setAnalyticsError] = useState(false)
  const effectiveQuestionId = selectValidQuestionId(selectedQuestion, questions)
  const currentSourceKey = createAnalyticsSourceKey(
    roundId ? { type: "round", id: roundId } : null,
  )
  const inferenceValueSeparator = locale === "zh-CN" ? "、" : ", "
  const currentQueryKey = createAnalyticsQueryKey({
    sourceKey: currentSourceKey,
    questionId: effectiveQuestionId,
    locale,
    filters: dimensionFilters,
    groupBy: groupByDimensions,
  })
  const dimensionMetadata =
    dimensionMetadataState?.sourceKey === currentSourceKey
      ? dimensionMetadataState.items
      : []

  const dimensionMetadataMap = useMemo(() => {
    const map = new Map<RespondentDimensionKey, DimensionMetadata>()
    dimensionMetadata.forEach(meta => map.set(meta.key, meta))
    return map
  }, [dimensionMetadata])

  useEffect(() => {
    setDimensionMetadataState(null)
    setDimensionFilters({})
    setGroupByDimensions([])
  }, [roundId])

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

  useEffect(() => {
    if (!roundId || !effectiveQuestionId) {
      setAnalyticsResultState(null)
      setAnalyticsError(false)
      setIsLoadingAnalytics(false)
      return
    }
    let cancelled = false
    const queryKey = currentQueryKey
    const sourceKey = currentSourceKey
    setAnalyticsResultState(null)
    setAnalyticsError(false)
    setIsLoadingAnalytics(true)
    const timer = window.setTimeout(async () => {
      try {
        const query = {
          questionId: effectiveQuestionId,
          filters: dimensionFilters,
          groupBy: groupByDimensions,
        }
        const result = await apiQueryRunAnalytics(locale, roundId, query)
        if (!cancelled) {
          setAnalyticsResultState({ key: queryKey, result })
          setDimensionMetadataState({
            sourceKey,
            items: result.dimensionMetadata,
          })
          setAnalyticsError(false)
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Analytics query error:", error)
          setAnalyticsResultState(null)
          setAnalyticsError(true)
        }
      } finally {
        if (!cancelled) setIsLoadingAnalytics(false)
      }
    }, 100)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [currentQueryKey, currentSourceKey, roundId, effectiveQuestionId, dimensionFilters, groupByDimensions, locale])

  const analyticsResult =
    analyticsResultState?.key === currentQueryKey
      ? analyticsResultState.result
      : null
  const filteredRespondentCount =
    analyticsResult?.scope.filteredRespondentCount ?? respondents.length
  const showAnalyticsResults =
    analyticsResult !== null &&
    !isLoadingAnalytics &&
    !analyticsError
  const filteredQuestionAnalysisForSelected =
    analyticsResult?.filteredQuestionAnalysis ?? null
  const groupedQuestionSummaries = (
    analyticsResult?.groupedQuestionSummaries ?? []
  ).map(group => ({
    label: group.label,
    respondentCount: group.respondentCount,
    validResponseCount: group.validResponseCount,
    responseData: group.analysis
      ? mapResponseDistributionEntries(group.analysis.responseDistribution)
      : [],
  }))

  const hasActiveFilters = Object.values(dimensionFilters).some(value => !!value)
  const activeFilterEntries = (Object.entries(dimensionFilters) as [
    RespondentDimensionKey,
    string,
  ][]).filter(([, value]) => !!value)
  const groupByDescription = groupByDimensions
    .map(key => dimensionMetadataMap.get(key)?.label ?? key)
    .join(" • ")

  useEffect(() => {
    setSelectedQuestion(current =>
      selectValidQuestionId(current, questions),
    )
  }, [questions])

  const sentimentData = [
    { name: messages.common.positive, value: sentiment.positive, fill: "#10b981" },
    { name: messages.common.neutral, value: sentiment.neutral, fill: "#64748b" },
    { name: messages.common.negative, value: sentiment.negative, fill: "#f43f5e" },
  ]

  const statusData = [
    { 
      name: mode === "survey" ? messages.analytics.surveyCompleted : messages.analytics.interviewCompleted,
      value: sessions.filter(s => s.status === "completed").length,
      fill: "#10b981"
    },
    { 
      name: mode === "survey" ? messages.analytics.surveyIncomplete : messages.common.respondentTerminated,
      value: sessions.filter(s => s.status === "terminated_by_respondent").length,
      fill: "#f59e0b"
    },
    { 
      name: mode === "survey" ? messages.analytics.surveyIncomplete : messages.common.interviewerTerminated,
      value: sessions.filter(s => s.status === "terminated_by_interviewer").length,
      fill: "#f43f5e"
    },
    { 
      name: mode === "survey" ? messages.analytics.surveyInProgress : messages.common.inProgress,
      value: sessions.filter(s => s.status === "in_progress").length,
      fill: "#3b82f6"
    },
    { 
      name: mode === "survey" ? messages.analytics.surveyPending : messages.common.pending,
      value: sessions.filter(s => s.status === "pending").length,
      fill: "#64748b"
    },
  ].filter(d => d.value > 0)

  const globalQuestionAnalysis = questionAnalysis.find(
    q => q.questionId === effectiveQuestionId,
  )

  const globalQuestionResponseData = globalQuestionAnalysis
    ? mapResponseDistributionEntries(globalQuestionAnalysis.responseDistribution)
    : []

  const filteredResponseData = filteredQuestionAnalysisForSelected
    ? mapResponseDistributionEntries(filteredQuestionAnalysisForSelected.responseDistribution)
    : []

  const getDemographicData = () => {
    const filtered = demographicAnalysis.filter(d => 
      d.questionId === effectiveQuestionId
    )
    
    if (selectedDemographic === "city") {
      return filtered.filter(d => !d.tagName.startsWith("收入:"))
    } else {
      return filtered.filter(d => d.tagName.startsWith("收入:"))
    }
  }

  const demographicData = getDemographicData()

  const completionRatio = progress.totalRespondents > 0
    ? progress.completedRespondents / progress.totalRespondents
    : 0
  const completionPercentage = Math.round(completionRatio * 100)

  const activityCount = mode === "survey"
    ? progress.answeredQuestions
    : sessions.reduce((acc, session) => acc + session.dialog.length, 0)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-col border-b border-border/50 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">
              {messages.analytics.panelTitle}
            </h2>
          </div>
          <ExportDialog roundId={roundId} filters={dimensionFilters} />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 p-3 sm:p-4">
        <div className="space-y-5">
          {/* Quick Stats Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">
                  {messages.analytics.totalRespondents}
                </span>
              </div>
              <span className="text-2xl font-bold text-foreground">
                {formatInteger(locale, progress.totalRespondents)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-muted-foreground">
                  {messages.analytics.completed}
                </span>
              </div>
              <span className="text-2xl font-bold text-emerald-400">
                {formatInteger(locale, progress.completedRespondents)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <XCircle className="w-4 h-4 text-rose-400" />
                <span className="text-xs text-muted-foreground">
                  {messages.analytics.terminated}
                </span>
              </div>
              <span className="text-2xl font-bold text-rose-400">
                {formatInteger(locale, progress.terminatedRespondents)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-secondary/30 border border-border/30">
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="w-4 h-4 text-accent" />
                <span className="text-xs text-muted-foreground">
                  {mode === "survey"
                    ? messages.analytics.totalSurveyAnswers
                    : messages.analytics.totalInterviewDialogs}
                </span>
              </div>
              <span className="text-2xl font-bold text-foreground">
                {formatInteger(locale, activityCount)}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                {mode === "survey"
                  ? messages.analytics.surveyCompletionRate
                  : messages.analytics.interviewCompletionRate}
              </span>
              <span className="text-foreground font-medium">
                {formatPercentage(locale, completionRatio)}
              </span>
            </div>
            <Progress value={completionPercentage} className="h-2 bg-secondary" />
          </div>

          {isLoadingAnalytics && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground"
            >
              {messages.analytics.loadingAnalytics}
            </div>
          )}
          {analyticsError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {messages.errors.analyticsQuery}
            </div>
          )}

          {/* Tabbed Analysis */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-secondary/30 p-1 sm:grid-cols-4">
              <TabsTrigger value="overview" className="min-h-9 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight">
                {messages.analytics.overview}
              </TabsTrigger>
              <TabsTrigger value="questions" className="min-h-9 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight">
                {messages.analytics.questionAnalysis}
              </TabsTrigger>
              <TabsTrigger value="demographic" className="min-h-9 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight">
                {messages.analytics.demographicAnalysis}
              </TabsTrigger>
              <TabsTrigger value="inference" className="min-h-9 whitespace-normal px-2 py-1.5 text-center text-xs leading-tight">
                {messages.analytics.inference}
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {roundId && (
                <ExceptionDrilldown
                  roundId={roundId}
                  onFocusRespondent={onFocusRespondent}
                />
              )}
              {/* Sentiment Pie Chart */}
              <div className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                <h3 className="text-xs font-medium text-foreground mb-3 flex items-center gap-1.5">
                  <PieChartIcon className="w-3.5 h-3.5 text-primary" />
                  {messages.analytics.sentimentDistribution}
                </h3>
                
                {sessions.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                    {messages.common.noData}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ChartContainer
                      config={{
                        positive: { label: messages.common.positive, color: "#10b981" },
                        neutral: { label: messages.common.neutral, color: "#64748b" },
                        negative: { label: messages.common.negative, color: "#f43f5e" },
                      }}
                      className="h-24 w-24"
                    >
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
                        <Tooltip
                          formatter={value =>
                            formatPercentage(locale, Number(value) / 100)
                          }
                        />
                      </PieChart>
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
                            {formatPercentage(locale, item.value / 100)}
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
                  {mode === "survey"
                    ? messages.analytics.surveyStatusDistribution
                    : messages.analytics.interviewStatusDistribution}
                </h3>
                
                {sessions.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                    {messages.common.noData}
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
                          {formatInteger(locale, item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Questions Tab */}
            <TabsContent value="questions" className="mt-4 space-y-4">
              <Select value={effectiveQuestionId} onValueChange={setSelectedQuestion}>
                <SelectTrigger className="w-full h-8 text-xs bg-secondary/30 border-border/30">
                  <SelectValue placeholder={messages.analytics.selectQuestion} />
                </SelectTrigger>
                <SelectContent>
                  {questions.map(q => (
                    <SelectItem key={q.id} value={q.id} className="text-xs">
                      {q.question.length > 30 ? q.question.substring(0, 30) + "..." : q.question}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {analyticsResult && (
                <AnalysisScopeSummary scope={analyticsResult.scope} mode={mode} />
              )}
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
                            <SelectValue placeholder={messages.common.all} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={CLEAR_DIMENSION_VALUE} className="text-xs">
                              {messages.common.all}
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
                    {showAnalyticsResults && (
                      <span className="text-[11px] text-muted-foreground">
                        {messages.analytics.filteredRespondents(
                          formatInteger(locale, filteredRespondentCount),
                          formatInteger(locale, respondents.length),
                        )}
                      </span>
                    )}
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
                      {messages.analytics.clearFilters}
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
                          {isActive
                            ? messages.analytics.cancelGroupBy(meta.label)
                            : messages.analytics.groupBy(meta.label)}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {showAnalyticsResults && (
                  <>
                {globalQuestionAnalysis ? (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-medium text-foreground">
                        {mode === "survey"
                          ? messages.analytics.surveyAnswerDistribution
                          : messages.analytics.interviewDialogDistribution}
                      </h3>
                      <Badge variant="outline" className="text-[10px]">
                        {messages.common.responses(
                          formatInteger(
                            locale,
                            globalQuestionAnalysis.totalResponses,
                          ),
                        )}
                      </Badge>
                    </div>

                    {globalQuestionAnalysis.averageScore != null && (
                      <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 text-[11px] text-muted-foreground">
                        {messages.analytics.averageScore}{" "}
                        <span className="text-sm font-bold text-primary">
                          {formatDecimal(
                            locale,
                            globalQuestionAnalysis.averageScore,
                            1,
                          )}
                        </span>
                      </div>
                    )}

                    {globalQuestionResponseData.length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
                        {messages.analytics.noAnswers}
                      </div>
                    ) : (
                      <>
                        {renderQuestionBarChart(
                          globalQuestionResponseData,
                          "#38bdf8",
                          locale,
                          messages,
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {messages.analytics.chartAxes}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 text-xs text-muted-foreground">
                    {messages.analytics.noQuestionData}
                  </div>
                )}

                {hasActiveFilters && (
                  <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-medium text-foreground">
                        {messages.analytics.filteredInsights}
                      </h3>
                      <Badge variant="outline" className="text-[10px]">
                        {messages.common.people(
                          formatInteger(locale, filteredRespondentCount),
                        )}
                      </Badge>
                    </div>
                    {filteredResponseData.length > 0 ? (
                      <>
                        {renderQuestionBarChart(
                          filteredResponseData,
                          "#f97316",
                          locale,
                          messages,
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {messages.analytics.chartAxes}
                        </p>
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-20 text-muted-foreground text-xs">
                        {messages.analytics.noFilteredAnswers}
                      </div>
                    )}
                  </div>
                )}

                {groupedQuestionSummaries.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        {messages.analytics.groupBy(
                          groupByDescription ||
                            messages.analytics.selectedDimensions,
                        )}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {messages.analytics.groupCount(
                          formatInteger(
                            locale,
                            groupedQuestionSummaries.length,
                          ),
                        )}
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
                            <div className="flex gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {messages.common.people(
                                formatInteger(locale, group.respondentCount),
                              )}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {messages.analytics.validResponseCount}: {formatInteger(locale, group.validResponseCount)}
                            </Badge>
                            </div>
                          </div>
                           {group.responseData.length === 0 ? (
                             <div className="text-[11px] text-muted-foreground">
                               {messages.analytics.noGroupAnswers}
                             </div>
                           ) : (
                             renderQuestionBarChart(
                               group.responseData,
                               "#a855f7",
                               locale,
                               messages,
                             )
                           )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {messages.analytics.combinedChartHint}
                </p>
                  </>
                )}
              </div>
            </TabsContent>

            {/* Demographic Tab */}
            <TabsContent value="demographic" className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <Select value={effectiveQuestionId} onValueChange={setSelectedQuestion}>
                  <SelectTrigger className="min-w-0 flex-1 h-8 text-xs bg-secondary/30 border-border/30">
                    <SelectValue placeholder={messages.analytics.selectQuestion} />
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
                  <SelectTrigger className="w-full sm:w-auto sm:min-w-24 h-8 text-xs bg-secondary/30 border-border/30">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="city" className="text-xs">
                      {messages.analytics.byCity}
                    </SelectItem>
                    <SelectItem value="income" className="text-xs">
                      {messages.analytics.byIncome}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                {demographicData.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-muted-foreground text-xs p-3 rounded-xl bg-secondary/20 border border-border/30">
                    {messages.analytics.noDemographicData}
                  </div>
                ) : (
                  demographicData.map((data, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-secondary/20 border border-border/30">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          <Filter className="w-3 h-3 text-primary" />
                          {data.tagName}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {messages.common.people(
                            formatInteger(locale, data.respondentCount),
                          )}
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
                              {formatInteger(locale, count)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="inference" className="mt-4 space-y-4">
              {inferenceSummary.length === 0 ? (
                <div className="rounded-lg border border-border/30 bg-secondary/20 p-4 text-sm text-muted-foreground">
                  {messages.analytics.noInferenceResults}
                </div>
              ) : (
                <>
                  <div className="grid gap-3">
                    {inferenceSummary.map((item) => (
                      <div key={item.taskId} className="rounded-lg border border-border/30 bg-secondary/20 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-medium text-foreground">{item.taskName}</h4>
                            <p className="text-xs text-muted-foreground">
                              {messages.analytics.inferenceTaskSummary(
                                formatInteger(locale, item.completed),
                                formatInteger(locale, item.total),
                                formatInteger(locale, item.failed),
                              )}
                            </p>
                          </div>
                          <Badge variant="outline">{item.kind}</Badge>
                        </div>
                        <div className="space-y-1">
                          {Object.entries(item.distribution).map(([value, count]) => (
                            <div key={value} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-muted-foreground">{value}</span>
                              <span className="font-medium text-foreground">{formatInteger(locale, count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-auto rounded-lg border border-border/30">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border/30 text-left text-muted-foreground">
                          <th className="p-2">{messages.analytics.respondent}</th>
                          <th className="p-2">{messages.analytics.task}</th>
                          <th className="p-2">{messages.analytics.value}</th>
                          <th className="p-2">{messages.rounds.status}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inferenceResults.map((result) => {
                          const respondent = respondents.find(item => item.id === result.respondentId)
                          return (
                            <tr key={result.id} className="border-b border-border/20">
                              <td className="p-2 text-muted-foreground">{respondent?.name || result.respondentId}</td>
                              <td className="p-2 text-muted-foreground">{result.taskName}</td>
                              <td className="p-2 text-foreground">{renderInferenceValue(result.value, inferenceValueSeparator)}</td>
                              <td className="p-2 text-muted-foreground">{result.status}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          {/* Status Indicator */}
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  isRunning
                    ? "bg-emerald-400 animate-pulse"
                    : sessions.length > 0
                    ? "bg-primary"
                    : "bg-muted-foreground"
                }`}
              />
              <span className="text-xs text-foreground">
                {isRunning
                  ? mode === "survey"
                    ? messages.analytics.surveyRunning
                    : messages.config.interviewRunning
                  : sessions.length > 0
                  ? mode === "survey"
                    ? messages.analytics.surveyCompleted
                    : messages.analytics.interviewCompleted
                  : messages.analytics.waitingToStart}
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
