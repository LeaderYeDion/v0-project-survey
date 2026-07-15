export type SimulationMode = "interview" | "survey"
export type Locale = "zh-CN" | "en-US"
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type SessionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "terminated_by_respondent"
  | "terminated_by_interviewer"
export type InferenceKind = "profile" | "attitude"
export type InferenceTaskStatus = "completed" | "skipped" | "failed"

export interface ProfileInferenceTask {
  id: string
  name: string
  options: string[]
  multiple: boolean
  enabled: boolean
}

export interface AttitudeInferenceTask {
  id: string
  name: string
  options: string[]
  enabled: boolean
}

export interface InferenceConfig {
  enabled: boolean
  profileEnabled: boolean
  attitudeEnabled: boolean
  profileTasks: ProfileInferenceTask[]
  attitudeTasks: AttitudeInferenceTask[]
}

export interface InferenceEvidence {
  questionId?: string | null
  messageId?: string | null
  excerpt?: string | null
}

export interface InferenceResult {
  id: string
  runId: string
  respondentId: string
  taskId: string
  taskName: string
  kind: InferenceKind
  value: string | string[] | null
  reason?: string | null
  evidence: InferenceEvidence[]
  status: InferenceTaskStatus
  error?: string | null
}

export interface InferenceSummaryItem {
  taskId: string
  taskName: string
  kind: InferenceKind
  total: number
  completed: number
  skipped: number
  failed: number
  distribution: Record<string, number>
}

export function createDefaultInferenceConfig(): InferenceConfig {
  return {
    enabled: false,
    profileEnabled: false,
    attitudeEnabled: false,
    profileTasks: [
      {
        id: "profile-income",
        name: "家庭年收入",
        options: ["5万以下", "5万-20万", "20万-50万", "50万-100万", "100万以上"],
        multiple: false,
        enabled: true,
      },
      {
        id: "profile-family-members",
        name: "家庭成员关系",
        options: ["父母", "配偶", "子女", "兄弟姐妹", "祖父母/外祖父母", "孙子女/外孙子女", "其他亲属", "其他非亲属"],
        multiple: true,
        enabled: true,
      },
      {
        id: "profile-monthly-spending",
        name: "家庭月消费主要支出项目",
        options: ["住房支出（房贷、租房等）", "日常生活消费（食品、衣物等）", "教育支出（学费、教辅等）", "交通支出（交通工具、油费、公交等）", "医疗健康支出（医疗保险、药品、就医等）", "休闲娱乐消费（旅游、娱乐、外出就餐等）", "其他家庭支出"],
        multiple: true,
        enabled: true,
      },
    ],
    attitudeTasks: [
      {
        id: "attitude-common-prosperity",
        name: "共同富裕倾向",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-public-service",
        name: "公共服务评价",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-upward-mobility",
        name: "向上流动倾向",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
      {
        id: "attitude-parent-comparison",
        name: "和父辈相比",
        options: ["积极", "中立", "消极"],
        enabled: true,
      },
    ],
  }
}

export function renderInferenceValue(value: string | string[] | null, separator = ", "): string {
  if (Array.isArray(value)) {
    return value.join(separator)
  }
  return value ?? ""
}

export interface SurveyConfig {
  title: string
  description: string
  questions: SurveyQuestion[]
  maxResponseTime: number
  respondentConfigs: RespondentConfig[]
  inferenceConfig?: InferenceConfig | null
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
  inferenceResults: InferenceResult[]
  inferenceSummary: InferenceSummaryItem[]
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
  inferenceResults: InferenceResult[]
  inferenceSummary: InferenceSummaryItem[]
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
