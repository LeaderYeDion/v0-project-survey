import type { RunStatus } from "./survey-contract"

export type RunAction =
  | "pause"
  | "resume"
  | "cancel"
  | "retry_failed"
  | "retry_incomplete"

export type RoundResourceRequestKind = "list" | "detail" | "copy"

export interface RoundResourceIdentity {
  projectId: string | null
  questionnaireId: string | null
}

export type GuardedRequestResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; error: unknown }
  | { status: "stale" }

export function allowedRunActions(
  status: RunStatus,
  failedCount: number,
  incompleteCount: number,
): RunAction[] {
  switch (status) {
    case "queued":
      return ["pause", "cancel"]
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

export function getRoundDisplayState<T extends { status: RunStatus; activeRespondentId: string | null }>(
  current: T | null,
  history: T | null,
) {
  const round = history ?? current
  const isRunning = round ? shouldPollRound(round.status) : false
  return {
    round,
    isRunning,
    activeRespondentId: round?.activeRespondentId ?? null,
    status: history ? "history" as const : isRunning ? "running" as const : "idle" as const,
  }
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

export function createRoundResourceRequestGuard(
  getIdentity: () => RoundResourceIdentity,
) {
  let generation = 0
  let nextRequestId = 0
  const latestByKind = new Map<RoundResourceRequestKind, number>()

  return {
    invalidate() {
      generation += 1
      latestByKind.clear()
    },
    async run<T>(
      kind: RoundResourceRequestKind,
      operation: () => Promise<T>,
    ): Promise<GuardedRequestResult<T>> {
      const requestId = ++nextRequestId
      const requestGeneration = generation
      const identity = getIdentity()
      latestByKind.set(kind, requestId)

      const isCurrent = () => {
        const currentIdentity = getIdentity()
        return requestGeneration === generation &&
          latestByKind.get(kind) === requestId &&
          currentIdentity.projectId === identity.projectId &&
          currentIdentity.questionnaireId === identity.questionnaireId
      }

      try {
        const value = await operation()
        return isCurrent() ? { status: "success", value } : { status: "stale" }
      } catch (error) {
        return isCurrent() ? { status: "error", error } : { status: "stale" }
      }
    },
  }
}
