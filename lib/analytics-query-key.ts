export interface AnalyticsSourceIdentity {
  type: string
  id: string
}

export interface AnalyticsQueryIdentity {
  sourceKey: string
  questionId: string
  locale: string
  filters: Readonly<Record<string, unknown>>
  groupBy: readonly string[]
}

export function createAnalyticsSourceKey(
  source: AnalyticsSourceIdentity | null,
): string {
  return source ? JSON.stringify([source.type, source.id]) : ""
}

export function createAnalyticsQueryKey(
  identity: AnalyticsQueryIdentity,
): string {
  const sortedFilters = Object.entries(identity.filters).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )

  return JSON.stringify([
    identity.sourceKey,
    identity.questionId,
    identity.locale,
    sortedFilters,
    identity.groupBy,
  ])
}
