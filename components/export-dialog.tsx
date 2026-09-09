"use client"

import { useState } from "react"
import { Download, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiExportRound, SurveyApiError } from "@/lib/survey-api"
import type { DimensionFilters, ExportFormat, ExportScope } from "@/lib/survey-contract"
import { formatDate } from "@/lib/i18n/locale"

interface ExportDialogProps {
  roundId: string | null
  filters: DimensionFilters
  onExported?: () => void
}

export function ExportDialog({ roundId, filters, onExported }: ExportDialogProps) {
  const { locale, messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>("json")
  const [scope, setScope] = useState<ExportScope>("full")
  const [filename, setFilename] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scopeLabel = (value: ExportScope) => {
    if (value === "filtered") return messages.rounds.exportFiltered
    if (value === "exceptions") return messages.rounds.exportExceptions
    return messages.rounds.exportFull
  }

  const submit = async () => {
    if (!roundId || pending || (scope === "filtered" && Object.keys(filters).length === 0)) return
    setPending(true)
    setError(null)
    try {
      const download = await apiExportRound(locale, roundId, {
        format,
        scope,
        filename,
        filters: scope === "filtered" ? filters : {},
      })
      const url = URL.createObjectURL(download.blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = download.filename
      anchor.click()
      URL.revokeObjectURL(url)
      const time = formatDate(locale, new Date(), { hour: "2-digit", minute: "2-digit" })
      toast.success(messages.rounds.exportSucceeded(scopeLabel(scope), time, download.filename))
      onExported?.()
      setOpen(false)
    } catch (cause) {
      const code = cause instanceof SurveyApiError ? cause.code : "SURVEY_API_ERROR"
      setError(messages.apiErrors[code as keyof typeof messages.apiErrors] ?? String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!roundId}>
          <Download className="size-3.5" />
          {messages.rounds.export}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.rounds.export}</DialogTitle>
          <DialogDescription>{messages.rounds.historyDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{messages.rounds.exportFormat}</Label>
            <Select value={format} onValueChange={value => setFormat(value as ExportFormat)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="json">{messages.common.json}</SelectItem>
                <SelectItem value="csv">{messages.common.csv}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{messages.rounds.exportScope}</Label>
            <Select value={scope} onValueChange={value => setScope(value as ExportScope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{messages.rounds.exportFull}</SelectItem>
                <SelectItem value="filtered" disabled={Object.keys(filters).length === 0}>
                  {messages.rounds.exportFiltered}
                </SelectItem>
                <SelectItem value="exceptions">{messages.rounds.exportExceptions}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="round-export-filename">{messages.rounds.exportFilename}</Label>
            <Input
              id="round-export-filename"
              name="filename"
              value={filename}
              placeholder={messages.rounds.exportFilenamePlaceholder}
              onChange={event => setFilename(event.target.value)}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button
            type="button"
            className="w-full"
            disabled={pending || !roundId || (scope === "filtered" && Object.keys(filters).length === 0)}
            onClick={() => void submit()}
          >
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            {pending ? messages.rounds.exporting : messages.rounds.export}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
