import { AlertTriangle } from "lucide-react"

import { useI18n } from "@/components/locale-provider"
import { Badge } from "@/components/ui/badge"
import type { AnalysisScope, SimulationMode } from "@/lib/survey-contract"
import { formatInteger } from "@/lib/i18n/locale"

interface AnalysisScopeSummaryProps {
  scope: AnalysisScope
  mode: SimulationMode
}

export function AnalysisScopeSummary({ scope, mode }: AnalysisScopeSummaryProps) {
  const { locale, messages } = useI18n()
  const distributionLabel =
    mode === "survey"
      ? messages.analytics.surveyAnswerDistribution
      : messages.analytics.interviewDialogDistribution

  return (
    <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {scope.label || messages.analytics.overallScope}
        </span>
        <span className="text-[10px] text-muted-foreground">{distributionLabel}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">
          {messages.analytics.populationCount}: {formatInteger(locale, scope.populationCount)}
        </Badge>
        <Badge variant="outline">
          {messages.analytics.filteredRespondentCount}: {formatInteger(locale, scope.filteredRespondentCount)}
        </Badge>
        <Badge variant="outline">
          {messages.analytics.validResponseCount}: {formatInteger(locale, scope.validResponseCount)}
        </Badge>
        <Badge variant="outline">
          {messages.analytics.excludedResponseCount}: {formatInteger(locale, scope.excludedResponseCount)}
        </Badge>
      </div>
      {scope.smallSample && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-3.5" />
          {messages.analytics.smallSampleWarning}
        </p>
      )}
    </section>
  )
}
