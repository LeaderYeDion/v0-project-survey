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
