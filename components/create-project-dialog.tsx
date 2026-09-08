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
import { Textarea } from "@/components/ui/textarea"
import type { CreateProjectInput } from "@/lib/survey-api"

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: CreateProjectInput) => Promise<void>
}) {
  const { messages } = useI18n()
  const [name, setName] = useState("")
  const [researchGoal, setResearchGoal] = useState("")
  const [principalName, setPrincipalName] = useState("")
  const [creating, setCreating] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      await onCreate({
        name: name.trim(),
        researchGoal: researchGoal.trim(),
        principalName: principalName.trim(),
      })
      setName("")
      setResearchGoal("")
      setPrincipalName("")
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
            <DialogTitle>{messages.resources.createProject}</DialogTitle>
            <DialogDescription>{messages.resources.noProjectsDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">{messages.resources.projectName}</Label>
            <Input id="project-name" value={name} onChange={event => setName(event.target.value)} required disabled={creating} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="research-goal">{messages.resources.researchGoal}</Label>
            <Textarea id="research-goal" value={researchGoal} onChange={event => setResearchGoal(event.target.value)} required disabled={creating} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="principal-name">{messages.resources.principalName}</Label>
            <Input id="principal-name" value={principalName} onChange={event => setPrincipalName(event.target.value)} required disabled={creating} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              {messages.resources.cancel}
            </Button>
            <Button type="submit" disabled={creating || !name.trim() || !researchGoal.trim() || !principalName.trim()}>
              {creating ? messages.resources.creating : messages.resources.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
