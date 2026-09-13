export interface LatestRequestTracker {
  begin: () => number
  isLatest: (requestId: number) => boolean
}

export function createLatestRequestTracker(): LatestRequestTracker {
  let latestRequestId = 0

  return {
    begin() {
      latestRequestId += 1
      return latestRequestId
    },
    isLatest(requestId) {
      return requestId === latestRequestId
    },
  }
}

type EffectRequestResult<T> =
  | { status: "success"; value: T }
  | { status: "error"; error: unknown }
  | { status: "stale" }

// Each effect owns its cancellation. Identity also guards the interval between
// rendering a new selection and React running the previous effect's cleanup.
export function createEffectRequestTracker(getIdentity: () => string) {
  const tracker = createLatestRequestTracker()
  return {
    begin() {
      const generation = tracker.begin()
      const identity = getIdentity()
      const controller = new AbortController()
      const isCurrent = () => !controller.signal.aborted &&
        tracker.isLatest(generation) && getIdentity() === identity
      return {
        abort: () => controller.abort(),
        async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<EffectRequestResult<T>> {
          try {
            const value = await operation(controller.signal)
            return isCurrent() ? { status: "success", value } : { status: "stale" }
          } catch (error) {
            return isCurrent() ? { status: "error", error } : { status: "stale" }
          }
        },
      }
    },
  }
}
