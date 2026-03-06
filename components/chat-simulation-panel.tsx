"use client"

import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MessageSquare, Sparkles } from "lucide-react"
import type { ChatMessage, VirtualAgent } from "@/lib/mock-survey-service"
import { cn } from "@/lib/utils"

interface ChatSimulationPanelProps {
  messages: ChatMessage[]
  agents: VirtualAgent[]
  isRunning: boolean
  currentQuestion: string
}

export function ChatSimulationPanel({
  messages,
  agents,
  isRunning,
  currentQuestion
}: ChatSimulationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const getSentimentColor = (sentiment: "positive" | "neutral" | "negative") => {
    switch (sentiment) {
      case "positive":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      case "negative":
        return "bg-rose-500/20 text-rose-400 border-rose-500/30"
      default:
        return "bg-slate-500/20 text-slate-400 border-slate-500/30"
    }
  }

  const getSentimentLabel = (sentiment: "positive" | "neutral" | "negative") => {
    switch (sentiment) {
      case "positive":
        return "正面"
      case "negative":
        return "负面"
      default:
        return "中性"
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">实时对话</h2>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge className="bg-primary/20 text-primary border-primary/30 animate-pulse">
              <Sparkles className="w-3 h-3 mr-1" />
              模拟中
            </Badge>
          )}
          <Badge variant="outline" className="border-border/50 text-muted-foreground">
            {messages.length} 条消息
          </Badge>
        </div>
      </div>

      {/* Current Question Banner */}
      {currentQuestion && (
        <div className="px-4 py-3 bg-primary/5 border-b border-border/30">
          <p className="text-sm text-muted-foreground">
            <span className="text-primary font-medium">当前问题：</span>
            {currentQuestion}
          </p>
        </div>
      )}

      {/* Agent Avatars Row */}
      {agents.length > 0 && (
        <div className="px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-1 overflow-x-auto">
            <span className="text-xs text-muted-foreground mr-2 whitespace-nowrap">参与者:</span>
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-secondary/50 border border-border/30"
              >
                <Avatar className="w-5 h-5">
                  <AvatarFallback className="text-xs bg-primary/20 text-primary">
                    {agent.avatar}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-foreground whitespace-nowrap">{agent.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-full bg-secondary/50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              {isRunning ? "等待代理响应..." : "开始模拟后将显示对话"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => {
              const isNewAgent =
                index === 0 || messages[index - 1].agentId !== message.agentId

              return (
                <div
                  key={message.id}
                  className={cn(
                    "group animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
                    !isNewAgent && "ml-11"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-start gap-3">
                    {isNewAgent && (
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-gradient-to-br from-primary/30 to-accent/30 text-foreground text-sm">
                          {message.agentAvatar}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className="flex-1 min-w-0">
                      {isNewAgent && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-foreground">
                            {message.agentName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(message.timestamp)}
                          </span>
                        </div>
                      )}
                      <div className="relative">
                        <div className="p-3 rounded-2xl rounded-tl-sm bg-secondary/50 border border-border/30 backdrop-blur-sm">
                          <p className="text-sm text-foreground leading-relaxed">
                            {message.content}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "absolute -bottom-2 right-2 text-[10px] px-1.5 py-0",
                            getSentimentColor(message.sentiment)
                          )}
                        >
                          {getSentimentLabel(message.sentiment)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Footer Stats */}
      <div className="px-4 py-3 border-t border-border/50 bg-secondary/20">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            代理: <span className="text-foreground">{agents.length}</span>
          </span>
          <span>
            消息: <span className="text-foreground">{messages.length}</span>
          </span>
          <span>
            情感分布: 
            <span className="text-emerald-400 ml-1">
              {messages.filter(m => m.sentiment === "positive").length}
            </span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-slate-400">
              {messages.filter(m => m.sentiment === "neutral").length}
            </span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-rose-400">
              {messages.filter(m => m.sentiment === "negative").length}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
