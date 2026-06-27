"use client"

import { useState } from "react"

import {
  Users,
  BarChart3,
  Clock,
  ClipboardList,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Activity,
} from "lucide-react"
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import type {
  InterviewSession,
  RespondentProfile,
  SurveyProgress,
  QuestionAnalysis,
  SurveyQuestion,
  SurveyResponse,
} from "@/lib/survey-api"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

interface BulkSurveyPanelProps {
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  progress: SurveyProgress
  questions: SurveyQuestion[]
  questionAnalysis: QuestionAnalysis[]
  responses: SurveyResponse[]
  isRunning: boolean
}

export function BulkSurveyPanel({
  sessions,
  respondents,
  progress,
  questions,
  questionAnalysis,
  responses,
  isRunning,
}: BulkSurveyPanelProps) {
  const completedCount = sessions.filter(s => s.status === "completed").length
  const total = progress.totalRespondents || respondents.length
  const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0

  const avgAnswered =
    sessions.length > 0
      ? Math.round(
          sessions.reduce((acc, s) => acc + s.completedQuestions, 0) /
            sessions.length,
        )
      : 0

  const [currentResponseIndex, setCurrentResponseIndex] = useState(0)
  const [showQuestionStats, setShowQuestionStats] = useState(true)
  const [showResponseDetail, setShowResponseDetail] = useState(true)

  const currentResponse =
    responses.length > 0 ? responses[currentResponseIndex] : null
  const currentRespondent = currentResponse
    ? respondents.find(r => r.id === currentResponse.respondentId) || null
    : null

  const handlePrevResponse = () => {
    if (responses.length === 0) return
    setCurrentResponseIndex(prev =>
      prev === 0 ? responses.length - 1 : prev - 1,
    )
  }

  const handleNextResponse = () => {
    if (responses.length === 0) return
    setCurrentResponseIndex(prev =>
      prev === responses.length - 1 ? 0 : prev + 1,
    )
  }

  const getQuestionById = (id: string) =>
    questions.find(q => q.id === id) || null

  const renderAnswerText = (question: SurveyQuestion, value?: any) => {
    if (value === undefined || value === null) return "未作答"

    if (question.type === "scale") {
      return `${value} 分`
    }

    if (question.type === "choice") {
      return String(value)
    }

    return String(value)
  }

  const pieColors = ["#0ea5e9", "#22c55e", "#f97316", "#6366f1", "#f97373"]

  const formatStat = (value?: number | null, digits = 1) =>
    value === undefined || value === null || Number.isNaN(value)
      ? "—"
      : value.toFixed(digits)

  const buildScaleDistribution = (entries: { label: string; value: number }[]) => {
    const numericEntries = entries
      .map(entry => {
        const parsed = Number(entry.label)
        if (Number.isFinite(parsed)) {
          return { value: parsed, count: Math.max(0, Math.trunc(entry.value)) }
        }
        return null
      })
      .filter(Boolean) as { value: number; count: number }[]

    const totalCount = numericEntries.reduce((acc, curr) => acc + curr.count, 0)

    if (totalCount === 0) {
      return null
    }

    const sum = numericEntries.reduce(
      (acc, curr) => acc + curr.value * curr.count,
      0,
    )
    const sumSquares = numericEntries.reduce(
      (acc, curr) => acc + curr.value ** 2 * curr.count,
      0,
    )

    const average = sum / totalCount

    const variance = sumSquares / totalCount - average ** 2

    const sorted = [...numericEntries].sort((a, b) => a.value - b.value)
    const getPercentile = (pct: number) => {
      if (pct < 0 || pct > 100) return average
      const target = (pct / 100) * totalCount
      let cursor = 0
      for (const entry of sorted) {
        cursor += entry.count
        if (cursor >= target) {
          return entry.value
        }
      }
      return sorted[sorted.length - 1].value
    }

    const median = getPercentile(50)

    const percentile = (value: number) => getPercentile(value)

    const modeEntry = sorted.reduce<{ value: number; count: number } | null>(
      (current, next) => {
        if (!current) return next
        return next.count > current.count ? next : current
      },
      null,
    )

    return {
      average,
      median,
      mode: modeEntry?.value,
      variance,
      p90: percentile(90),
      p70: percentile(70),
      p50: median,
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <div className="flex flex-col">
            <h2 className="font-semibold text-foreground text-sm">
              问卷调研总览
            </h2>
            <p className="text-xs text-muted-foreground">
              模拟真实线上问卷，聚焦样本规模与统计结果
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="text-[11px] border-border/60 bg-secondary/40 flex items-center gap-1"
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              isRunning ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"
            }`}
          />
          {isRunning ? "实时更新中" : "静态结果"}
        </Badge>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:gap-4 sm:p-4">
        {/* Top summary cards */}
        <div className="grid shrink-0 grid-cols-1 gap-2 min-[480px]:grid-cols-3 sm:gap-3">
          <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
            <div className="flex items-center gap-2 mb-1.5">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-[11px] text-muted-foreground">样本量</span>
            </div>
            <div className="text-2xl font-semibold text-foreground">
              {total}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              来自配置的虚拟受访者画像
            </p>
          </div>

          <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
            <div className="flex items-center gap-2 mb-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] text-muted-foreground">
                完成问卷
              </span>
            </div>
            <div className="text-2xl font-semibold text-emerald-400">
              {completedCount}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              完成率约 {completionRate}%
            </p>
          </div>

          <div className="p-3 rounded-xl bg-secondary/30 border border-border/40">
            <div className="flex items-center gap-2 mb-1.5">
              <BarChart3 className="w-4 h-4 text-accent" />
              <span className="text-[11px] text-muted-foreground">
                平均作答题数
              </span>
            </div>
            <div className="text-2xl font-semibold text-foreground">
              {avgAnswered}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              模拟问卷的整体完备度
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Question-level statistics */}
          <div
            className={`rounded-xl bg-secondary/20 border border-border/40 p-3 flex flex-col overflow-hidden ${
              showQuestionStats ? "flex-1 min-h-0" : "flex-none"
            }`}
          >
            <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="min-w-0 break-words text-xs font-medium text-foreground">
                  按问题的结果统计
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowQuestionStats(v => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Activity className="w-3 h-3" />
                <span>全局视角</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${
                    showQuestionStats ? "rotate-0" : "-rotate-90"
                  }`}
                />
              </button>
            </div>

            {showQuestionStats && (
              <ScrollArea className="flex-1 min-h-0 pr-2">
                {questionAnalysis.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
                    暂无统计数据，开始问卷后将自动生成。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {questionAnalysis.map((qa, idx) => {
                      const question = getQuestionById(qa.questionId)
                      const baseKey = `${qa.questionId}-${idx}`

                      if (!question) return null

                      // 构造图表数据
                      const entries = Object.entries(
                        qa.responseDistribution,
                      ).map(([k, v]) => ({ label: k, value: v }))

                      return (
                        <div
                          key={baseKey}
                          className="p-2.5 rounded-lg bg-background/50 border border-border/40"
                        >
                          <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 break-words text-xs font-medium text-foreground">
                              {qa.questionText}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] border-border/60"
                            >
                              {qa.totalResponses} 份回答
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground mb-2">
                            类型：{question.type === "choice"
                              ? "选择题"
                              : question.type === "scale"
                              ? "打分题"
                              : "开放题"}
                          </p>

                          {question.type === "choice" &&
                            entries.length > 0 && (
                              <div className="h-28">
                                <ResponsiveContainer
                                  width="100%"
                                  height="100%"
                                >
                                  <PieChart>
                                    <Pie
                                      data={entries}
                                      dataKey="value"
                                      nameKey="label"
                                      outerRadius={40}
                                      labelLine={false}
                                    >
                                      {entries.map((_, i) => (
                                        <Cell
                                          key={`${baseKey}-cell-${i}`}
                                          fill={
                                            pieColors[i % pieColors.length]
                                          }
                                        />
                                      ))}
                                    </Pie>
                                    <Tooltip
                                      formatter={(value: any, _name, props) => [
                                        value,
                                        (props?.payload as any)?.label,
                                      ]}
                                    />
                                  </PieChart>
                                </ResponsiveContainer>
                              </div>
                            )}

                          {question.type === "scale" &&
                            entries.length > 0 && (
                              <div className="w-full flex justify-center">
                                {(() => {
                                  const scaleStats = buildScaleDistribution(entries)
                                  if (!scaleStats) {
                                    return (
                                      <div className="max-w-[320px] w-full text-center text-[11px] text-muted-foreground">
                                        当前数据不能用于统计摘要。
                                      </div>
                                    )
                                  }

                                  const statsList = [
                                    ["平均值", formatStat(scaleStats.average)],
                                    ["中位数", formatStat(scaleStats.median)],
                                    ["众数", formatStat(scaleStats.mode)],
                                    ["方差", formatStat(scaleStats.variance, 2)],
                                    ["P90", formatStat(scaleStats.p90)],
                                    ["P70", formatStat(scaleStats.p70)],
                                    ["P50", formatStat(scaleStats.p50)],
                                  ]

                                  return (
                                    <div className="max-w-[320px] w-full space-y-2">
                                      <div className="rounded-lg bg-background/40 border border-border/50 p-3 text-[12px] mx-auto">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-semibold text-foreground">
                                            打分题统计摘要
                                          </span>
                                          <span className="text-[11px] text-muted-foreground">
                                            节省空间，直观阅读
                                          </span>
                                        </div>
                                        <div className="space-y-1">
                                          {statsList.map(([label, value]) => (
                                            <div
                                              key={label}
                                              className="flex justify-between text-muted-foreground"
                                            >
                                              <span className="">{label}</span>
                                              <span className="font-semibold text-foreground">
                                                {value}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })()}
                              </div>
                            )}

                          {question.type === "text" && (
                            <div className="text-[11px] text-muted-foreground">
                              开放题暂不展示图表，可以在右侧分析面板查看更多详情。
                            </div>
                          )}

                          {qa.averageScore !== undefined &&
                            question.type === "scale" && (
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                平均分约{" "}
                                <span className="font-semibold text-foreground">
                                  {qa.averageScore.toFixed(1)}
                                </span>
                              </div>
                            )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            )}
          </div>

          {/* Response-level detail */}
          <div
            className={`rounded-xl bg-secondary/20 border border-border/40 p-3 flex flex-col overflow-hidden ${
              showResponseDetail ? "flex-1 min-h-0" : "flex-none"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-foreground">
                  单份问卷详情
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {responses.length > 0
                    ? `第 ${currentResponseIndex + 1} / ${
                        responses.length
                      } 份`
                    : "暂无问卷"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevResponse}
                    className="w-6 h-6 rounded-full border border-border/50 flex items-center justify-center text-muted-foreground hover:bg-secondary/60 disabled:opacity-40"
                    disabled={responses.length === 0}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextResponse}
                    className="w-6 h-6 rounded-full border border-border/50 flex items-center justify-center text-muted-foreground hover:bg-secondary/60 disabled:opacity-40"
                    disabled={responses.length === 0}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowResponseDetail(v => !v)}
                  className="ml-1 flex items-center justify-center w-6 h-6 rounded-full border border-border/50 text-muted-foreground hover:bg-secondary/60"
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${
                      showResponseDetail ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                </button>
              </div>
            </div>

            {showResponseDetail && (
              <>
                {responses.length === 0 || !currentResponse ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground">
                    <Clock className="w-6 h-6 mb-2 text-muted-foreground" />
                    暂无问卷结果，开始模拟后可逐份查看完整回答。
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Respondent info */}
                    <div className="mb-2 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">
                          受访者信息
                        </p>
                        {currentRespondent ? (
                          <p className="text-[11px] text-foreground">
                            {currentRespondent.age} 岁 ·{" "}
                            {currentRespondent.gender} ·{" "}
                            {currentRespondent.city} ·{" "}
                            {currentRespondent.occupation}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            受访者信息缺失
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] border-border/60"
                      >
                        状态：{currentResponse.status === "completed"
                          ? "已完成"
                          : currentResponse.status === "partial"
                          ? "部分完成"
                          : currentResponse.status ===
                            "terminated_by_respondent"
                          ? "受访者终止"
                          : "调研方终止"}
                      </Badge>
                    </div>

                    <ScrollArea className="flex-1 min-h-0 pr-2">
                      <div className="space-y-2.5">
                        {questions.map(q => {
                          const answer = currentResponse.answers[q.id]
                          const displayValue =
                            answer?.type === "scale"
                              ? answer.value
                              : answer?.type === "choice"
                              ? answer.value
                              : (answer as any)?.value

                          return (
                            <div
                              key={`${currentResponse.id}-${q.id}`}
                              className="p-2 rounded-lg bg-background/40 border border-border/40"
                            >
                              <p className="text-[11px] text-muted-foreground mb-1">
                                {q.question}
                              </p>
                              <p className="text-[13px] text-foreground">
                                {renderAnswerText(q, displayValue)}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
