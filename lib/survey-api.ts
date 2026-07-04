export * from "./survey-contract"

import type {
  AnalyticsQuery,
  AnalyticsQueryResult,
  RunSnapshot,
  SimulationMode,
  SurveyConfig,
  SurveyHistoryRecord,
} from "./survey-contract"

const API_BASE = "/survey-api"

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw new Error(`Survey API ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

export function apiFetchDefaultTemplate(
  signal?: AbortSignal,
): Promise<SurveyConfig> {
  return request("/templates/default", { signal })
}

export function apiCreateRun(
  mode: SimulationMode,
  config: SurveyConfig,
): Promise<RunSnapshot> {
  return request("/runs", {
    method: "POST",
    body: JSON.stringify({ mode, config }),
  })
}

export function apiFetchRun(
  runId: string,
  signal?: AbortSignal,
): Promise<RunSnapshot> {
  return request(`/runs/${runId}`, { signal })
}

export function apiCancelRun(runId: string): Promise<RunSnapshot> {
  return request(`/runs/${runId}/cancel`, { method: "POST" })
}

export function apiSaveRunToHistory(
  runId: string,
): Promise<SurveyHistoryRecord> {
  return request("/history", {
    method: "POST",
    body: JSON.stringify({ runId }),
  })
}

export function apiFetchSurveyHistory(): Promise<SurveyHistoryRecord[]> {
  return request("/history")
}

export function apiFetchSurveyHistoryById(
  id: string,
): Promise<SurveyHistoryRecord> {
  return request(`/history/${id}`)
}

export function apiQueryRunAnalytics(
  runId: string,
  query: AnalyticsQuery,
): Promise<AnalyticsQueryResult> {
  return request(`/runs/${runId}/analytics/query`, {
    method: "POST",
    body: JSON.stringify(query),
  })
}

export function apiQueryHistoryAnalytics(
  historyId: string,
  query: AnalyticsQuery,
): Promise<AnalyticsQueryResult> {
  return request(`/history/${historyId}/analytics/query`, {
    method: "POST",
    body: JSON.stringify(query),
  })
}

export async function apiExportSurveyResults(
  source: { type: "run" | "history"; id: string },
  format: "json" | "csv",
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE}/${source.type === "run" ? "runs" : "history"}/${source.id}/exports?format=${format}`,
  )
  if (!response.ok) {
    throw new Error(`Survey API ${response.status}: ${await response.text()}`)
  }
  return response.blob()
}
