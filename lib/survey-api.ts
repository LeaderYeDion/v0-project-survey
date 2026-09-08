export * from "./survey-contract"

import { readCsrfToken } from "./csrf"
import type {
  AnalyticsQuery,
  AnalyticsQueryResult,
  CreateProjectInput,
  CreateQuestionnaireInput,
  CurrentUser,
  Project,
  Questionnaire,
  QuestionnaireVersion,
  RoundSnapshot,
  SaveQuestionnaireDraftInput,
  SurveyConfig,
  SurveyHistoryRecord,
  SimulationMode,
} from "./survey-contract"
import type { Locale } from "./i18n/locale"

const API_BASE = "/survey-api"
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"])
const outstandingRequests = new Set<AbortController>()
const sessionExpiredListeners = new Set<() => void>()

interface ApiErrorPayload {
  code?: unknown
  message?: unknown
  details?: unknown
}

interface RequestOptions extends RequestInit {
  csrf?: boolean
  responseType?: "json" | "blob"
}

export class SurveyApiError extends Error {
  readonly code: string
  readonly details: unknown
  readonly status: number

  constructor(status: number, payload: ApiErrorPayload) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `Survey API request failed (${status})`
    super(message)
    this.name = "SurveyApiError"
    this.status = status
    this.code =
      typeof payload.code === "string" ? payload.code : "SURVEY_API_ERROR"
    this.details = payload.details ?? null
  }
}

export function onAuthSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener)
  return () => sessionExpiredListeners.delete(listener)
}

export function abortOutstandingSurveyRequests(): void {
  for (const controller of outstandingRequests) controller.abort()
  outstandingRequests.clear()
}

async function parseError(response: Response): Promise<SurveyApiError> {
  let payload: ApiErrorPayload = {}
  try {
    payload = (await response.json()) as ApiErrorPayload
  } catch {
    payload = { message: response.statusText }
  }
  return new SurveyApiError(response.status, payload)
}

async function request<T>(
  locale: Locale,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    csrf = true,
    responseType = "json",
    signal: callerSignal,
    ...init
  } = options
  const method = (init.method ?? "GET").toUpperCase()
  const isMutation = mutationMethods.has(method)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true })

  const headers = new Headers(init.headers)
  headers.set("Accept-Language", locale)
  if (isMutation) {
    headers.set("Content-Type", "application/json")
    if (csrf) {
      const token = readCsrfToken()
      if (token) headers.set("X-CSRF-Token", token)
    }
  }

  outstandingRequests.add(controller)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "same-origin",
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = await parseError(response)
      if (error.code === "AUTH_SESSION_EXPIRED") {
        for (const listener of sessionExpiredListeners) listener()
      }
      throw error
    }
    if (response.status === 204) return undefined as T
    return (responseType === "blob"
      ? await response.blob()
      : await response.json()) as T
  } finally {
    outstandingRequests.delete(controller)
    callerSignal?.removeEventListener("abort", abortFromCaller)
  }
}

export function apiLogin(
  locale: Locale,
  input: { username: string; password: string },
): Promise<CurrentUser> {
  return request(locale, "/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
    csrf: false,
  })
}

export function apiLogout(locale: Locale): Promise<void> {
  return request(locale, "/auth/logout", { method: "POST" })
}

export function apiMe(locale: Locale, signal?: AbortSignal): Promise<CurrentUser> {
  return request(locale, "/auth/me", { signal })
}

export function apiListProjects(locale: Locale, signal?: AbortSignal): Promise<Project[]> {
  return request(locale, "/projects", { signal })
}

export function apiCreateProject(locale: Locale, input: CreateProjectInput): Promise<Project> {
  return request(locale, "/projects", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function apiGetProject(locale: Locale, projectId: string, signal?: AbortSignal): Promise<Project> {
  return request(locale, `/projects/${projectId}`, { signal })
}

export function apiUpdateProject(
  locale: Locale,
  projectId: string,
  input: Partial<CreateProjectInput>,
): Promise<Project> {
  return request(locale, `/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export function apiListQuestionnaires(
  locale: Locale,
  projectId: string,
  signal?: AbortSignal,
): Promise<Questionnaire[]> {
  return request(locale, `/projects/${projectId}/questionnaires`, { signal })
}

export function apiCreateQuestionnaire(
  locale: Locale,
  projectId: string,
  input: CreateQuestionnaireInput,
): Promise<Questionnaire> {
  return request(locale, `/projects/${projectId}/questionnaires`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function apiGetQuestionnaire(
  locale: Locale,
  questionnaireId: string,
  signal?: AbortSignal,
): Promise<Questionnaire> {
  return request(locale, `/questionnaires/${questionnaireId}`, { signal })
}

export function apiSaveQuestionnaireDraft(
  locale: Locale,
  questionnaireId: string,
  input: SaveQuestionnaireDraftInput,
): Promise<Questionnaire> {
  return request(locale, `/questionnaires/${questionnaireId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export function apiListQuestionnaireVersions(
  locale: Locale,
  questionnaireId: string,
  signal?: AbortSignal,
): Promise<QuestionnaireVersion[]> {
  return request(locale, `/questionnaires/${questionnaireId}/versions`, {
    signal,
  })
}

export function apiCreateRound(locale: Locale, questionnaireId: string): Promise<RoundSnapshot> {
  return request(locale, `/questionnaires/${questionnaireId}/rounds`, {
    method: "POST",
  })
}

export function apiFetchRound(locale: Locale, roundId: string, signal?: AbortSignal): Promise<RoundSnapshot> {
  return request(locale, `/rounds/${roundId}`, { signal })
}

export function apiListProjectRounds(locale: Locale, projectId: string, signal?: AbortSignal): Promise<RoundSnapshot[]> {
  return request(locale, `/projects/${projectId}/rounds`, { signal })
}

export function apiCancelRound(locale: Locale, roundId: string): Promise<RoundSnapshot> {
  return request(locale, `/rounds/${roundId}/cancel`, { method: "POST" })
}

export function apiFetchDefaultTemplate(
  locale: Locale,
  mode: SimulationMode = "survey",
  signal?: AbortSignal,
): Promise<SurveyConfig> {
  return request(locale, `/templates/default?mode=${mode}`, { signal })
}

export const apiFetchRun = apiFetchRound
export const apiCancelRun = apiCancelRound

export function apiSaveRunToHistory(
  _locale: Locale,
  _runId: string,
): Promise<SurveyHistoryRecord> {
  return Promise.reject(legacyHistoryDisabledError())
}

export function apiFetchSurveyHistory(
  _locale: Locale,
): Promise<SurveyHistoryRecord[]> {
  return Promise.reject(legacyHistoryDisabledError())
}

export function apiFetchSurveyHistoryById(
  _locale: Locale,
  _id: string,
): Promise<SurveyHistoryRecord> {
  return Promise.reject(legacyHistoryDisabledError())
}

export function apiQueryRunAnalytics(
  locale: Locale,
  roundId: string,
  query: AnalyticsQuery,
  signal?: AbortSignal,
): Promise<AnalyticsQueryResult> {
  return request(locale, `/rounds/${roundId}/analytics/query`, {
    method: "POST",
    body: JSON.stringify(query),
    signal,
  })
}

export function apiQueryHistoryAnalytics(
  _locale: Locale,
  _historyId: string,
  _query: AnalyticsQuery,
  _signal?: AbortSignal,
): Promise<AnalyticsQueryResult> {
  return Promise.reject(legacyHistoryDisabledError())
}

export async function apiExportSurveyResults(
  locale: Locale,
  source: { type: "run" | "history"; id: string },
  format: "json" | "csv",
): Promise<Blob> {
  if (source.type === "history") {
    return Promise.reject(legacyHistoryDisabledError())
  }
  return request(locale, `/rounds/${source.id}/exports`, {
    method: "POST",
    body: JSON.stringify({ format, scope: "full", filename: "survey-results" }),
    responseType: "blob",
  })
}

function legacyHistoryDisabledError(): SurveyApiError {
  return new SurveyApiError(410, {
    code: "LEGACY_HISTORY_DISABLED",
    message: "Legacy history endpoints are disabled",
  })
}
