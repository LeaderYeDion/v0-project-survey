"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, ChevronRight } from "lucide-react"

import { useI18n } from "@/components/locale-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiFetchRoundExceptions, SurveyApiError } from "@/lib/survey-api"
import type { ExceptionGroup, ExceptionReport } from "@/lib/survey-contract"
import { formatDate, formatInteger } from "@/lib/i18n/locale"

interface ExceptionDrilldownProps {
  roundId: string
  onFocusRespondent: (respondentId: string) => void
}

export function ExceptionDrilldown({ roundId, onFocusRespondent }: ExceptionDrilldownProps) {
  const { locale, messages } = useI18n()
  const [report, setReport] = useState<ExceptionReport | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<ExceptionGroup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setSelectedGroup(null)
    apiFetchRoundExceptions(locale, roundId, controller.signal)
      .then(next => setReport(next))
      .catch(cause => {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        const code = cause instanceof SurveyApiError ? cause.code : "SURVEY_API_ERROR"
        setError(messages.apiErrors[code as keyof typeof messages.apiErrors] ?? String(cause))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [locale, messages.apiErrors, roundId])

  return (
    <section className="space-y-3 rounded-xl border border-border/30 bg-secondary/20 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-500" />
        <h3 className="text-xs font-medium">{messages.rounds.exceptions}</h3>
        {report && <Badge variant="outline">{messages.rounds.exceptionCount(report.totalCount)}</Badge>}
      </div>
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground">{messages.common.inProgress}</p>
      ) : error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : !report || report.groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">{messages.rounds.noExceptions}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {report.groups.map(group => (
              <Button
                key={`${group.status}-${group.code}`}
                type="button"
                variant={selectedGroup?.code === group.code ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSelectedGroup(group)}
              >
                {group.reason} ({formatInteger(locale, group.count)})
              </Button>
            ))}
          </div>
          {selectedGroup && (
            <div className="space-y-2">
              {selectedGroup.respondents.map(respondent => (
                <button
                  key={respondent.respondentId}
                  type="button"
                  className="w-full rounded-lg border border-border/40 bg-background/50 p-2 text-left hover:border-primary/50"
                  onClick={() => onFocusRespondent(respondent.respondentId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{respondent.profile.name}</span>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {messages.rounds.progress(
                      formatInteger(locale, respondent.completedQuestions),
                      formatInteger(locale, respondent.totalQuestions),
                    )}
                  </p>
                  {respondent.lastValidAnswer && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-foreground">
                      {messages.rounds.evidence}: {respondent.lastValidAnswer}
                      {respondent.lastValidAnswerAt
                        ? ` · ${formatDate(locale, respondent.lastValidAnswerAt, { hour: "2-digit", minute: "2-digit" })}`
                        : ""}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
