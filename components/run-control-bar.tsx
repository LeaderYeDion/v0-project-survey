"use client"

import { LoaderCircle, Pause, Play, RotateCcw, Square } from "lucide-react"

import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import type { RoundSnapshot } from "@/lib/survey-contract"
import { allowedRunActions, type RunAction } from "@/lib/run-actions"

interface RunControlBarProps {
  round: RoundSnapshot | null
  pendingAction: RunAction | null
  feedback: { kind: "success" | "error"; message: string } | null
  onAction: (action: RunAction) => void
}

export function RunControlBar({
  round,
  pendingAction,
  feedback,
  onAction,
}: RunControlBarProps) {
  const { messages } = useI18n()
  if (!round) return null

  const actions = allowedRunActions(
    round.status,
    round.progress.failedRespondents,
    round.progress.incompleteRespondents,
  )
  const actionLabel = (action: RunAction) => {
    if (action === "pause") return messages.rounds.pause
    if (action === "resume") return messages.rounds.resume
    if (action === "cancel") return messages.rounds.cancel
    if (action === "retry_failed") return messages.rounds.retryFailed
    return messages.rounds.retryIncomplete
  }
  const ActionIcon = ({ action }: { action: RunAction }) => {
    if (action === "pause") return <Pause className="size-3.5" />
    if (action === "resume") return <Play className="size-3.5" />
    if (action === "cancel") return <Square className="size-3.5" />
    return <RotateCcw className="size-3.5" />
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 bg-card/60 px-3 py-2">
      <span className="text-xs font-medium text-foreground">{round.name}</span>
      <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground">
        {round.status}
      </span>
      {round.status === "pausing" && (
        <span className="text-xs text-amber-600 dark:text-amber-300">
          {messages.rounds.pausing}
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        {actions.map(action => (
          <Button
            key={action}
            type="button"
            variant={action === "cancel" ? "destructive" : "outline"}
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => onAction(action)}
          >
            {pendingAction === action ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ActionIcon action={action} />
            )}
            {pendingAction === action
              ? messages.rounds.actionPending
              : actionLabel(action)}
          </Button>
        ))}
      </div>
      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={
            feedback.kind === "error"
              ? "w-full text-xs text-destructive"
              : "w-full text-xs text-emerald-600 dark:text-emerald-300"
          }
        >
          {feedback.message}
        </p>
      )}
    </div>
  )
}
