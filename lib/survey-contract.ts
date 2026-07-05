export type SimulationMode = "interview" | "survey"
export type Locale = "zh-CN" | "en-US"
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type SessionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "terminated_by_respondent"
  | "terminated_by_interviewer"

export interface SurveyConfig {
  title: string
  description: string
  questions: SurveyQuestion[]
  maxResponseTime: number
  respondentConfigs: RespondentConfig[]
}

export interface RespondentConfig {
  id: string
  gender: string
  ageRange: string
  occupation: string
  city: string
  income: string
  count: number
}

export interface SurveyQuestion {
  id: string
  type: "text" | "choice" | "scale"
  question: string
  options?: string[] | null
  scale?: { min: number; max: number } | null
}

export type AnswerValue =
  | { type: "text"; value: string }
  | { type: "choice"; value: string }
  | { type: "scale"; value: number }

export interface RespondentProfile {
  id: string
  name: string
  nickname: string
  avatar: string
  age: number
  gender: string
  occupation: string
  city: string
  income: string
  education: string
  maritalStatus: string
  tags: string[]
  configId: string
}

export interface DialogMessage {
  id: string
  role: "interviewer" | "respondent"
  content: string
  timestamp: string
  questionId?: string | null
  sentiment?: "positive" | "neutral" | "negative" | null
  answerValue?: AnswerValue | null
}

export interface InterviewSession {
  respondentId: string
  status: SessionStatus
  terminationReason?: string | null
  dialog: DialogMessage[]
  completedQuestions: number
  totalQuestions: number
  startTime?: string | null
  endTime?: string | null
}

export interface SurveyResponse {
  id: string
  surveyId: string
  respondentId: string
  answers: Record<string, AnswerValue>
  status:
    | "completed"
    | "partial"
    | "terminated_by_respondent"
    | "terminated_by_interviewer"
  startedAt?: string | null
  finishedAt?: string | null
}

export interface SurveyProgress {
  totalRespondents: number
  completedRespondents: number
  inProgressRespondents: number
  terminatedRespondents: number
  currentRespondentIndex: number
}

export interface SentimentData {
  positive: number
  neutral: number
  negative: number
}

export interface QuestionAnalysis {
  questionId: string
  questionText: string
  questionType: "text" | "choice" | "scale"
  totalResponses: number
  responseDistribution: Record<string, number>
  averageScore?: number | null
}

export interface DemographicAnalysis {
  tagName: string
  questionId: string
  questionText: string
  responseDistribution: Record<string, number>
  respondentCount: number
}

export interface RunSnapshot {
  id: string
  mode: SimulationMode
  locale: Locale
  status: RunStatus
  config: SurveyConfig
  respondents: RespondentProfile[]
  sessions: InterviewSession[]
  progress: SurveyProgress
  sentiment: SentimentData
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  responses: SurveyResponse[]
  activeRespondentId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export interface SurveyHistoryRecord {
  id: string
  runId: string
  mode: SimulationMode
  locale: Locale
  savedAt: string
  config: SurveyConfig
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  progress: SurveyProgress
  sentiment: SentimentData
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
  responses: SurveyResponse[]
}

export const respondentDimensionKeys = [
  "gender",
  "ageRange",
  "occupation",
  "city",
  "income",
] as const

export type RespondentDimensionKey = (typeof respondentDimensionKeys)[number]
export type DimensionFilters = Partial<Record<RespondentDimensionKey, string>>

export interface DimensionMetadata {
  key: RespondentDimensionKey
  label: string
  values: string[]
}

export interface GroupedQuestionSummary {
  label: string
  respondentCount: number
  totalResponses: number
  analysis: QuestionAnalysis | null
}

export interface AnalyticsQuery {
  questionId: string
  filters: DimensionFilters
  groupBy: RespondentDimensionKey[]
}

export interface AnalyticsQueryResult {
  dimensionMetadata: DimensionMetadata[]
  filteredRespondentCount: number
  totalRespondentCount: number
  filteredQuestionAnalysis: QuestionAnalysis | null
  groupedQuestionSummaries: GroupedQuestionSummary[]
}
