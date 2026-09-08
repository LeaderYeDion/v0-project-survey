"use client"

import { Plus } from "lucide-react"
import { useI18n } from "@/components/locale-provider"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Project, Questionnaire } from "@/lib/survey-api"

export function ResearchResourceSelector({
  projects,
  questionnaires,
  projectId,
  questionnaireId,
  onProjectChange,
  onQuestionnaireChange,
  onCreateProject,
  onCreateQuestionnaire,
}: {
  projects: Project[]
  questionnaires: Questionnaire[]
  projectId: string | null
  questionnaireId: string | null
  onProjectChange: (id: string) => void
  onQuestionnaireChange: (id: string) => void
  onCreateProject: () => void
  onCreateQuestionnaire: () => void
}) {
  const { messages } = useI18n()

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <Select value={projectId ?? undefined} onValueChange={onProjectChange}>
        <SelectTrigger aria-label={messages.resources.selectProject} className="min-w-44 flex-1 sm:flex-none">
          <SelectValue placeholder={messages.resources.selectProject} />
        </SelectTrigger>
        <SelectContent>
          {projects.map(project => (
            <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" aria-label={messages.resources.createProject} onClick={onCreateProject}>
        <Plus className="size-4" />
      </Button>
      <Select
        value={questionnaireId ?? undefined}
        onValueChange={onQuestionnaireChange}
        disabled={!projectId || questionnaires.length === 0}
      >
        <SelectTrigger aria-label={messages.resources.selectQuestionnaire} className="min-w-52 flex-1 sm:flex-none">
          <SelectValue placeholder={messages.resources.selectQuestionnaire} />
        </SelectTrigger>
        <SelectContent>
          {questionnaires.map(questionnaire => (
            <SelectItem key={questionnaire.id} value={questionnaire.id}>
              {questionnaire.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" aria-label={messages.resources.createQuestionnaire} onClick={onCreateQuestionnaire} disabled={!projectId}>
        <Plus className="size-4" />
      </Button>
    </div>
  )
}
