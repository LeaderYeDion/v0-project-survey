import type { RunStatus } from "./survey-contract"

export type RunAction =
  | "pause"
  | "resume"
  | "cancel"
  | "retry_failed"
  | "retry_incomplete"

export function allowedRunActions(
  status: RunStatus,
  failedCount: number,
  incompleteCount: number,
): RunAction[] {
  switch (status) {
    case "queued":
    case "pausing":
      return ["cancel"]
    case "running":
      return ["pause", "cancel"]
    case "paused":
      return ["resume", "cancel"]
    case "completed_with_errors":
      return failedCount > 0 ? ["retry_failed"] : []
    case "cancelled":
      return incompleteCount > 0 ? ["retry_incomplete"] : []
    default:
      return []
  }
}

export function shouldPollRound(status: RunStatus): boolean {
  return status === "queued" || status === "running" || status === "pausing"
}

export function mergePolledRoundSnapshot<T extends { id: string; rowVersion: number }>(
  current: T | null,
  incoming: T,
  polledRoundId: string,
): T | null {
  if (!current || current.id !== polledRoundId || incoming.id !== polledRoundId) {
    return current
  }
  if (current.rowVersion > incoming.rowVersion) {
    return current
  }
  return incoming
}

export function createRunMutationGuard() {
  let pending: RunAction | null = null

  return {
    pendingAction: () => pending,
    async run<T>(action: RunAction, operation: () => Promise<T>): Promise<T | null> {
      if (pending !== null) return null
      pending = action
      try {
        return await operation()
      } finally {
        pending = null
      }
    },
  }
}
