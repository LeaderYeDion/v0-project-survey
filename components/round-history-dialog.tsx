"use client"

import { useEffect, useState } from "react"
import { Clock, Copy, History, LoaderCircle } from "lucide-react"

import { useI18n } from "@/components/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { apiListRoundExports, SurveyApiError } from "@/lib/survey-api"
import type { ExportRecord, Questionnaire, RoundSnapshot } from "@/lib/survey-contract"
import { formatDate, formatInteger } from "@/lib/i18n/locale"

interface RoundHistoryDialogProps {
  rounds: RoundSnapshot[]
  questionnaires: Questionnaire[]
  selectedRound: RoundSnapshot | null
  loading: boolean
  error: string | null
  copyingRoundId: string | null
  onRefresh: () => void
  onSelectRound: (roundId: string) => void
  onCopyRound: (roundId: string) => void
}

export function RoundHistoryDialog({
  rounds,
  questionnaires,
  selectedRound,
  loading,
  error,
  copyingRoundId,
  onRefresh,
  onSelectRound,
  onCopyRound,
}: RoundHistoryDialogProps) {
  const { locale, messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [exports, setExports] = useState<ExportRecord[]>([])
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedRound) {
      setExports([])
      return
    }
    const controller = new AbortController()
    setExports([])
    setExportError(null)
    apiListRoundExports(locale, selectedRound.id, controller.signal)
      .then(setExports)
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        const code = cause instanceof SurveyApiError ? cause.code : "SURVEY_API_ERROR"
        setExportError(messages.apiErrors[code as keyof typeof messages.apiErrors] ?? String(cause))
      })
    return () => controller.abort()
  }, [locale, messages.apiErrors, open, selectedRound])

  const setDialogOpen = (next: boolean) => {
    setOpen(next)
    if (next) onRefresh()
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History className="size-3.5" />
          {messages.rounds.history}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{messages.rounds.historyTitle}</DialogTitle>
          <DialogDescription>{messages.rounds.historyDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ScrollArea className="max-h-[65dvh] pr-3">
            {loading ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {messages.rounds.historyLoading}
              </p>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            ) : rounds.length === 0 ? (
              <p className="text-sm text-muted-foreground">{messages.rounds.historyEmpty}</p>
            ) : (
              <div className="space-y-2">
                {rounds.map(round => {
                  const questionnaire = questionnaires.find(item => item.id === round.questionnaireId)
                  return (
                    <button
                      key={round.id}
                      type="button"
                      className="w-full rounded-lg border border-border/40 bg-secondary/20 p-3 text-left hover:border-primary/50"
                      onClick={() => onSelectRound(round.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{round.name}</span>
                        <Badge variant="outline">{round.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {questionnaire?.title ?? round.config.title} · {round.mode}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {messages.rounds.configVersion}: {round.configVersionId.slice(-8)} · {messages.rounds.questionnaireVersion}: {round.questionnaireVersionId.slice(-8)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {messages.rounds.sampleSummary(
                          formatInteger(locale, round.progress.completedRespondents),
                          formatInteger(locale, round.progress.totalRespondents),
                        )}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDate(locale, round.createdAt, { dateStyle: "short", timeStyle: "short" })}
                        {round.finishedAt
                          ? ` – ${formatDate(locale, round.finishedAt, { dateStyle: "short", timeStyle: "short" })}`
                          : ""}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
          <ScrollArea className="max-h-[65dvh] rounded-lg border border-border/40 p-3">
            {selectedRound ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">{selectedRound.name}</h3>
                    <p className="text-[10px] text-muted-foreground">{selectedRound.id}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onCopyRound(selectedRound.id)}
                    disabled={copyingRoundId !== null}
                  >
                    {copyingRoundId === selectedRound.id
                      ? <LoaderCircle className="size-3.5 animate-spin" />
                      : <Copy className="size-3.5" />}
                    {copyingRoundId === selectedRound.id ? messages.rounds.copying : messages.rounds.copy}
                  </Button>
                </div>
                <section>
                  <h4 className="mb-2 text-xs font-medium">{messages.rounds.immutableConfig}</h4>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-secondary/30 p-2 text-[10px]">
                    {JSON.stringify(selectedRound.config, null, 2)}
                  </pre>
                </section>
                <section>
                  <h4 className="mb-2 text-xs font-medium">{messages.rounds.exports}</h4>
                  {exportError ? (
                    <p role="alert" className="text-xs text-destructive">{exportError}</p>
                  ) : exports.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{messages.rounds.noExports}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {exports.map(record => (
                        <li key={record.id} className="rounded border border-border/30 p-2 text-[10px]">
                          <span className="font-medium">{record.filename}</span>
                          <span className="ml-2 text-muted-foreground">{record.scope} · {record.status}</span>
                          <span className="block text-muted-foreground">
                            {formatDate(locale, record.finishedAt ?? record.createdAt, { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{messages.rounds.viewResult}</p>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
