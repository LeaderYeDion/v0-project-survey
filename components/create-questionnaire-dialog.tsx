"use client"

import { useState, type FormEvent } from "react"
import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { CreateQuestionnaireInput, SimulationMode, SurveyConfig } from "@/lib/survey-api"

function initialConfig(
  title: string,
  description: string,
  question: string,
  defaultGender: string,
): SurveyConfig {
  return {
    title,
    description,
    questions: [
      {
        id: "q1",
        type: "text",
        question,
      },
    ],
    maxResponseTime: 30,
    respondentConfigs: [
      {
        id: "default-group",
        gender: defaultGender,
        ageRange: "25-35",
        occupation: "",
        city: "",
        income: "",
        count: 1,
      },
    ],
  }
}

export function CreateQuestionnaireDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: CreateQuestionnaireInput) => Promise<void>
}) {
  const { messages } = useI18n()
  const [mode, setMode] = useState<SimulationMode>("survey")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const config = initialConfig(
        title.trim(),
        description.trim(),
        mode === "survey"
          ? messages.resources.defaultSurveyQuestion
          : messages.resources.defaultInterviewPrompt,
        messages.resources.defaultGender,
      )
      await onCreate({ mode, config, schemaVersion: 1 })
      setTitle("")
      setDescription("")
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{messages.resources.createQuestionnaire}</DialogTitle>
            <DialogDescription>{messages.resources.noQuestionnaires}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{messages.dashboard.chooseMode}</Label>
            <Select value={mode} onValueChange={value => setMode(value as SimulationMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="survey">{messages.dashboard.surveyMode}</SelectItem>
                <SelectItem value="interview">{messages.dashboard.interviewMode}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="questionnaire-title">{messages.resources.questionnaireTitle}</Label>
            <Input id="questionnaire-title" value={title} onChange={event => setTitle(event.target.value)} required disabled={creating} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="questionnaire-description">{messages.resources.questionnaireDescription}</Label>
            <Textarea id="questionnaire-description" value={description} onChange={event => setDescription(event.target.value)} disabled={creating} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              {messages.resources.cancel}
            </Button>
            <Button type="submit" disabled={creating || !title.trim()}>
              {creating ? messages.resources.creating : messages.resources.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
