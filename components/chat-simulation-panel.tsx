"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MessageSquare, Sparkles, User, MapPin, Briefcase, DollarSign, AlertCircle } from "lucide-react"
import type { InterviewSession, RespondentProfile } from "@/lib/mock-survey-service"
import { cn } from "@/lib/utils"

interface ChatSimulationPanelProps {
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  isRunning: boolean
  currentRespondentId: string | null
  onSelectRespondent: (id: string) => void
}

type MobileInterviewView = "respondents" | "conversation"

export function ChatSimulationPanel({
  sessions,
  respondents,
  isRunning,
  currentRespondentId,
  onSelectRespondent
}: ChatSimulationPanelProps) {
  const [selectedRespondentId, setSelectedRespondentId] = useState<string | null>(null)
  const [mobileView, setMobileView] =
    useState<MobileInterviewView>("respondents")

  // Auto-select the current respondent being interviewed
  useEffect(() => {
    if (currentRespondentId && !selectedRespondentId) {
      setSelectedRespondentId(currentRespondentId)
      setMobileView("conversation")
    }
  }, [currentRespondentId, selectedRespondentId])

  const selectedRespondent = respondents.find(r => r.id === selectedRespondentId)
  const selectedSession = sessions.find(s => s.respondentId === selectedRespondentId)

  const getSentimentColor = (sentiment?: "positive" | "neutral" | "negative") => {
    switch (sentiment) {
      case "positive":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      case "negative":
        return "bg-rose-500/20 text-rose-400 border-rose-500/30"
      default:
        return "bg-slate-500/20 text-slate-400 border-slate-500/30"
    }
  }

  const getSentimentLabel = (sentiment?: "positive" | "neutral" | "negative") => {
    switch (sentiment) {
      case "positive":
        return "正面"
      case "negative":
        return "负面"
      default:
        return "中性"
    }
  }

  const getStatusBadge = (status: InterviewSession["status"]) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">已完成</Badge>
      case "in_progress":
        return <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] animate-pulse">进行中</Badge>
      case "terminated_by_respondent":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">受访者终止</Badge>
      case "terminated_by_interviewer":
        return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px]">调研方终止</Badge>
      default:
        return <Badge className="bg-secondary/50 text-muted-foreground border-border/30 text-[10px]">等待中</Badge>
    }
  }

  const formatTime = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  }

  const handleSelectRespondent = (id: string) => {
    setSelectedRespondentId(id)
    setMobileView("conversation")
    onSelectRespondent(id)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden md:flex-row">
      <nav
        aria-label="访谈内容导航"
        className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/30 bg-card/50 p-1 md:hidden"
      >
        <button
          type="button"
          aria-pressed={mobileView === "respondents"}
          onClick={() => setMobileView("respondents")}
          className={
            mobileView === "respondents"
              ? "h-8 rounded-md bg-primary/15 text-xs font-medium text-primary"
              : "h-8 rounded-md text-xs text-muted-foreground"
          }
        >
          受访者
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "conversation"}
          onClick={() => setMobileView("conversation")}
          className={
            mobileView === "conversation"
              ? "h-8 rounded-md bg-primary/15 text-xs font-medium text-primary"
              : "h-8 rounded-md text-xs text-muted-foreground"
          }
        >
          对话
        </button>
      </nav>

      {/* Respondent List Sidebar */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-col border-border/30 md:flex md:w-64 md:shrink-0 md:border-r",
          mobileView === "respondents" ? "flex flex-1" : "hidden",
        )}
      >
        <div className="p-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">受访者列表</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {respondents.length} 位受访者 / {sessions.filter(s => s.status === "completed").length} 已完成
          </p>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border/50 scrollbar-track-transparent hover:scrollbar-thumb-border">
          <div className="p-2 space-y-1">
            {respondents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                开始模拟后显示受访者
              </div>
            ) : (
              respondents.map(respondent => {
                const session = sessions.find(s => s.respondentId === respondent.id)
                const isSelected = selectedRespondentId === respondent.id
                const isCurrent = currentRespondentId === respondent.id

                return (
                  <button
                    key={respondent.id}
                    onClick={() => handleSelectRespondent(respondent.id)}
                    className={cn(
                      "w-full p-2.5 rounded-lg text-left transition-all",
                      "border border-transparent hover:border-border/50",
                      isSelected
                        ? "bg-primary/10 border-primary/30"
                        : "hover:bg-secondary/30",
                      isCurrent && !isSelected && "ring-1 ring-primary/50"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <Avatar className="w-9 h-9 flex-shrink-0">
                        <AvatarFallback className={cn(
                          "text-sm",
                          isSelected
                            ? "bg-primary/30 text-primary"
                            : "bg-secondary/50 text-foreground"
                        )}>
                          {respondent.avatar}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-sm font-medium text-foreground truncate">
                            {respondent.name}
                          </span>
                          {isCurrent && (
                            <span className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {respondent.age}岁 · {respondent.city}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          {session ? getStatusBadge(session.status) : getStatusBadge("pending")}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          mobileView === "conversation" ? "flex" : "hidden md:flex",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">对话详情</h2>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Badge className="bg-primary/20 text-primary border-primary/30 animate-pulse">
                <Sparkles className="w-3 h-3 mr-1" />
                模拟中
              </Badge>
            )}
          </div>
        </div>

        {/* Selected Respondent Info */}
        {selectedRespondent ? (
          <>
            <div className="border-b border-border/30 bg-secondary/20 px-3 py-3 sm:px-4">
              <div className="flex items-center gap-3">
                <Avatar className="w-12 h-12">
                  <AvatarFallback className="bg-gradient-to-br from-primary/30 to-accent/30 text-lg">
                    {selectedRespondent.avatar}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{selectedRespondent.name}</span>
                    <span className="text-sm text-muted-foreground">({selectedRespondent.nickname})</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {selectedRespondent.age}岁 · {selectedRespondent.gender}
                    </span>
                    <span className="flex items-center gap-1">
                      <Briefcase className="w-3 h-3" />
                      {selectedRespondent.occupation}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {selectedRespondent.city}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {selectedRespondent.income}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selectedRespondent.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 border-border/50">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Dialog Messages */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-border/50 scrollbar-track-transparent hover:scrollbar-thumb-border sm:p-4">
              {!selectedSession || selectedSession.dialog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
                    <MessageSquare className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {selectedSession?.status === "pending"
                      ? "等待开始访谈..."
                      : "暂无对话内容"}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {selectedSession.dialog.map((message, index) => (
                    <div
                      key={message.id}
                      className={cn(
                        "animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
                        message.role === "interviewer"
                          ? "sm:pr-12"
                          : "sm:pl-12"
                      )}
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      <div className={cn(
                        "flex items-start gap-3",
                        message.role === "interviewer" ? "flex-row" : "flex-row-reverse"
                      )}>
                        <Avatar className="w-8 h-8 flex-shrink-0">
                          <AvatarFallback className={cn(
                            "text-sm",
                            message.role === "interviewer"
                              ? "bg-primary/20 text-primary"
                              : "bg-gradient-to-br from-primary/30 to-accent/30 text-foreground"
                          )}>
                            {message.role === "interviewer" ? "Q" : selectedRespondent.avatar}
                          </AvatarFallback>
                        </Avatar>
                        <div className={cn(
                          "flex-1 min-w-0",
                          message.role === "respondent" && "text-right"
                        )}>
                          <div className={cn(
                            "flex items-center gap-2 mb-1",
                            message.role === "respondent" && "justify-end"
                          )}>
                            <span className="text-sm font-medium text-foreground">
                              {message.role === "interviewer" ? "调研员" : selectedRespondent.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(message.timestamp)}
                            </span>
                          </div>
                          <div className="relative inline-block max-w-[90%]">
                            <div className={cn(
                              "p-3 rounded-2xl",
                              message.role === "interviewer"
                                ? "rounded-tl-sm bg-primary/10 border border-primary/20"
                                : "rounded-tr-sm bg-secondary/50 border border-border/30"
                            )}>
                              <p className={cn(
                                "break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]",
                                message.role === "respondent" && "text-left"
                              )}>
                                {message.content}
                              </p>
                            </div>
                            {message.role === "respondent" && message.sentiment && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "absolute -bottom-2 left-2 text-[10px] px-1.5 py-0",
                                  getSentimentColor(message.sentiment)
                                )}
                              >
                                {getSentimentLabel(message.sentiment)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Termination Notice */}
                  {selectedSession.terminationReason && (
                    <div className="flex items-center justify-center py-4">
                      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
                        <AlertCircle className="w-4 h-4 text-amber-400" />
                        <span className="text-sm text-amber-400">
                          {selectedSession.terminationReason}
                        </span>
                      </div>
                    </div>
                  )}

                  </div>
              )}
            </div>

            {/* Footer Stats */}
            <div className="px-4 py-3 border-t border-border/50 bg-secondary/20">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  问题进度: <span className="text-foreground">{selectedSession?.completedQuestions || 0}</span> / {selectedSession?.totalQuestions || "-"}
                </span>
                <span>
                  对话消息: <span className="text-foreground">{selectedSession?.dialog.length || 0}</span>
                </span>
                {selectedSession && (
                  <span>
                    状态: {getStatusBadge(selectedSession.status)}
                  </span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <div className="w-20 h-20 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
              <User className="w-10 h-10 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm mb-2">
              选择一位受访者查看对话详情
            </p>
            <p className="text-muted-foreground text-xs">
              每位受访者的完整访谈过程将在此显示
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
