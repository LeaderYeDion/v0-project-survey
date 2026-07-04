export * from "./survey-contract"

import type {
  AnalyticsQuery,
  AnalyticsQueryResult,
  RunSnapshot,
  SimulationMode,
  SurveyConfig,
  SurveyHistoryRecord,
} from "./survey-contract"
import type { Locale } from "./i18n/locale"

const API_BASE = "/survey-api"

async function request<T>(
  locale: Locale,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Content-Type", "application/json")
  headers.set("Accept-Language", locale)
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    throw new Error(`Survey API ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

export function apiFetchDefaultTemplate(
  locale: Locale,
  signal?: AbortSignal,
): Promise<SurveyConfig> {
  return request(locale, "/templates/default", { signal })
}

export function apiCreateRun(
  locale: Locale,
  mode: SimulationMode,
  config: SurveyConfig,
): Promise<RunSnapshot> {
  return request(locale, "/runs", {
    method: "POST",
    body: JSON.stringify({ mode, config }),
  })
}

export function apiFetchRun(
  locale: Locale,
  runId: string,
  signal?: AbortSignal,
): Promise<RunSnapshot> {
  return request(locale, `/runs/${runId}`, { signal })
}

export function apiCancelRun(
  locale: Locale,
  runId: string,
): Promise<RunSnapshot> {
  return request(locale, `/runs/${runId}/cancel`, { method: "POST" })
}

export function apiSaveRunToHistory(
  locale: Locale,
  runId: string,
): Promise<SurveyHistoryRecord> {
  return request(locale, "/history", {
    method: "POST",
    body: JSON.stringify({ runId }),
  })
}

export function apiFetchSurveyHistory(
  locale: Locale,
): Promise<SurveyHistoryRecord[]> {
  return request(locale, "/history")
}

export function apiFetchSurveyHistoryById(
  locale: Locale,
  id: string,
): Promise<SurveyHistoryRecord> {
  return request(locale, `/history/${id}`)
}

export function apiQueryRunAnalytics(
  locale: Locale,
  runId: string,
  query: AnalyticsQuery,
): Promise<AnalyticsQueryResult> {
  return request(locale, `/runs/${runId}/analytics/query`, {
    method: "POST",
    body: JSON.stringify(query),
  })
}

export function apiQueryHistoryAnalytics(
  locale: Locale,
  historyId: string,
  query: AnalyticsQuery,
): Promise<AnalyticsQueryResult> {
  return request(locale, `/history/${historyId}/analytics/query`, {
    method: "POST",
    body: JSON.stringify(query),
  })
}

export async function apiExportSurveyResults(
  locale: Locale,
  source: { type: "run" | "history"; id: string },
  format: "json" | "csv",
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/${source.type === "run" ? "runs" : "history"}/${source.id}/exports?format=${format}`,
    {
      headers: {
        "Accept-Language": locale,
      },
    },
  )
  if (!response.ok) {
    throw new Error(`Survey API ${response.status}: ${await response.text()}`)
  }
  return response.blob()
}
