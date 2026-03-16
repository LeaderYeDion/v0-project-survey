// Unified Survey API layer
// All "backend-like" interactions should go through this file so that
// it can be easily swapped out for a real backend implementation later.
//
// For now this file only proxies to the existing mock-survey-service
// and keeps the same behaviour.

export * from "./mock-survey-service"

import {
  type SurveyConfig,
  type InterviewSession,
  type RespondentProfile,
  type SurveyProgress,
  type SentimentData,
  type QuestionAnalysis,
  type DemographicAnalysis,
  type SurveyHistoryRecord,
  type SurveyResponse,
  generateRespondentsFromConfig,
  saveSurveyToHistory,
  fetchSurveyHistory,
  fetchSurveyHistoryById,
  exportSurveyResults,
  buildSurveyResponses,
} from "./mock-survey-service"

// In the future these can be switched to real HTTP calls.
// The front-end should only import from this file, not directly from mock-survey-service.

export async function apiGenerateRespondentsFromConfig(
  configs: SurveyConfig["respondentConfigs"],
): Promise<RespondentProfile[]> {
  return generateRespondentsFromConfig(configs)
}

export async function apiSaveSurveyToHistory(params: {
  config: SurveyConfig
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  progress: SurveyProgress
  sentiment: SentimentData
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
}): Promise<SurveyHistoryRecord> {
  const {
    config,
    sessions,
    respondents,
    progress,
    sentiment,
    questionAnalysis,
    demographicAnalysis,
  } = params

  return saveSurveyToHistory(
    config,
    sessions,
    respondents,
    progress,
    sentiment,
    questionAnalysis,
    demographicAnalysis,
  )
}

export async function apiFetchSurveyHistory(): Promise<SurveyHistoryRecord[]> {
  return fetchSurveyHistory()
}

export async function apiFetchSurveyHistoryById(
  id: string,
): Promise<SurveyHistoryRecord | null> {
  return fetchSurveyHistoryById(id)
}

export async function apiExportSurveyResults(
  sessions: InterviewSession[],
  respondents: RespondentProfile[],
  format: "json" | "csv",
): Promise<Blob> {
  return exportSurveyResults(sessions, respondents, format)
}

export type { SurveyResponse }

export function apiBuildSurveyResponses(
  sessions: InterviewSession[],
  surveyId: string,
): SurveyResponse[] {
  return buildSurveyResponses(sessions, surveyId)
}

