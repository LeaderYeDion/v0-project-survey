export interface SavedSelection {
  projectId: string | null
  questionnaireId: string | null
  roundId: string | null
}
type SelectionStorage = Pick<Storage, "getItem" | "setItem">

export function readSelection(storage: SelectionStorage, userId: string): SavedSelection | null {
  try {
    const data = JSON.parse(storage.getItem(`survey-selection:${userId}`) ?? "null")
    if (!data || ![data.projectId, data.questionnaireId, data.roundId].every(value => value === null || typeof value === "string")) return null
    return { projectId: data.projectId, questionnaireId: data.questionnaireId, roundId: data.roundId }
  } catch { return null }
}

export function writeSelection(storage: SelectionStorage, userId: string, selection: SavedSelection) {
  try { storage.setItem(`survey-selection:${userId}`, JSON.stringify(selection)) } catch { /* Browsing still works with storage disabled. */ }
}

export function isSavedDraft(config: unknown, persisted: string, status: string): boolean {
  return status === "saved" && JSON.stringify(config) === persisted
}
