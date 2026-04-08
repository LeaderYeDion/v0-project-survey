// Mock Survey Service
// This file contains mock methods that simulate backend communication
// Replace these methods with actual API calls when integrating with a real backend

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
  options?: string[]
  scale?: { min: number; max: number }
}

// Structured answer value for a single question in a questionnaire
export type AnswerValue =
  | { type: "text"; value: string }
  | { type: "choice"; value: string } // 单选，value 为选项文本
  | { type: "scale"; value: number }

// Extended respondent profile with detailed demographics
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
  configId: string // 关联的配置ID
}

export interface DialogMessage {
  id: string
  role: "interviewer" | "respondent"
  content: string
  timestamp: Date
  questionId?: string
  sentiment?: "positive" | "neutral" | "negative"
  answerValue?: string | number
}

export interface InterviewSession {
  respondentId: string
  status: "pending" | "in_progress" | "completed" | "terminated_by_respondent" | "terminated_by_interviewer"
  terminationReason?: string
  dialog: DialogMessage[]
  completedQuestions: number
  totalQuestions: number
  startTime?: Date
  endTime?: Date
}

// Structured view of a single respondent's questionnaire response
export interface SurveyResponse {
  id: string
  surveyId: string
  respondentId: string
  answers: Record<string, AnswerValue> // key = questionId
  status: "completed" | "partial" | "terminated_by_respondent" | "terminated_by_interviewer"
  startedAt?: Date
  finishedAt?: Date
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

// Survey history record
export interface SurveyHistoryRecord {
  id: string
  savedAt: Date
  config: SurveyConfig
  sessions: InterviewSession[]
  respondents: RespondentProfile[]
  progress: SurveyProgress
  sentiment: SentimentData
  questionAnalysis: QuestionAnalysis[]
  demographicAnalysis: DemographicAnalysis[]
}

// Mock storage for history records
let mockHistoryStorage: SurveyHistoryRecord[] = []

// Mock method: Save survey to history
export async function saveSurveyToHistory(
  config: SurveyConfig,
  sessions: InterviewSession[],
  respondents: RespondentProfile[],
  progress: SurveyProgress,
  sentiment: SentimentData,
  questionAnalysis: QuestionAnalysis[],
  demographicAnalysis: DemographicAnalysis[]
): Promise<SurveyHistoryRecord> {
  await new Promise(resolve => setTimeout(resolve, 500))
  
  const record: SurveyHistoryRecord = {
    id: `survey-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    savedAt: new Date(),
    config,
    sessions: JSON.parse(JSON.stringify(sessions)),
    respondents: JSON.parse(JSON.stringify(respondents)),
    progress: { ...progress },
    sentiment: { ...sentiment },
    questionAnalysis: JSON.parse(JSON.stringify(questionAnalysis)),
    demographicAnalysis: JSON.parse(JSON.stringify(demographicAnalysis)),
  }
  
  mockHistoryStorage.unshift(record)
  return record
}

// Mock method: Fetch history list
export async function fetchSurveyHistory(): Promise<SurveyHistoryRecord[]> {
  await new Promise(resolve => setTimeout(resolve, 300))
  return mockHistoryStorage
}

// Mock method: Fetch single history record
export async function fetchSurveyHistoryById(id: string): Promise<SurveyHistoryRecord | null> {
  await new Promise(resolve => setTimeout(resolve, 200))
  return mockHistoryStorage.find(r => r.id === id) || null
}

// Helper: build structured survey responses from interview sessions
export function buildSurveyResponses(
  sessions: InterviewSession[],
  surveyId: string,
): SurveyResponse[] {
  return sessions.map(session => {
    const answers: Record<string, AnswerValue> = {}

    session.dialog.forEach(msg => {
      if (msg.role === "respondent" && msg.questionId && msg.answerValue !== undefined) {
        const qId = msg.questionId
        if (typeof msg.answerValue === "number") {
          answers[qId] = { type: "scale", value: msg.answerValue }
        } else if (typeof msg.answerValue === "string") {
          // 目前文本与选项文本都为 string，这里简单归类：
          // scale 上面已经处理，剩余 string 根据内容区分 text/choice 会比较牵强，
          // 先统一当作 choice/text 的混合，前端再结合题目类型解释。
          answers[qId] = { type: "choice", value: msg.answerValue }
        }
      }
    })

    const startedAt = session.startTime
    const finishedAt = session.endTime

    const status =
      session.status === "pending" || session.status === "in_progress"
        ? "partial"
        : session.status

    return {
      id: `resp-${session.respondentId}`,
      surveyId,
      respondentId: session.respondentId,
      answers,
      status,
      startedAt,
      finishedAt,
    }
  })
}

// Name pools for generating respondents
const maleNames = ["张伟", "王强", "李明", "陈军", "刘洋", "孙磊", "周杰", "吴刚", "郑浩", "赵鹏"]
const femaleNames = ["李娜", "王芳", "张敏", "刘静", "陈丽", "杨雪", "赵敏", "周琳", "吴倩", "孙燕"]
const nicknames = ["小王", "阿强", "大伟", "小李", "小刘", "阿杰", "小孙", "阿敏", "小芳", "娜娜"]
const educations = ["高中", "大专", "本科", "硕士", "博士"]
const maritalStatuses = ["未婚", "已婚", "已婚有孩"]
const avatars = ["👨‍💼", "👩‍💻", "👨‍🔬", "👩‍🎨", "👨‍🎤", "👩‍⚕️", "👨‍🍳", "👩‍🏫", "👨‍💻", "👩‍🔬"]

// Mock method: Generate respondent list based on configs
export async function generateRespondentsFromConfig(
  configs: RespondentConfig[]
): Promise<RespondentProfile[]> {
  await new Promise(resolve => setTimeout(resolve, 600))
  
  const result: RespondentProfile[] = []
  let globalIndex = 0

  configs.forEach(config => {
    for (let i = 0; i < config.count; i++) {
      globalIndex++
      const isMale = config.gender === "男" || (config.gender === "不限" && Math.random() > 0.5)
      const namePool = isMale ? maleNames : femaleNames
      
      // Parse age range
      let age: number
      const ageMatch = config.ageRange.match(/(\d+)[-~](\d+)/)
      if (ageMatch) {
        const minAge = parseInt(ageMatch[1])
        const maxAge = parseInt(ageMatch[2])
        age = Math.floor(Math.random() * (maxAge - minAge + 1)) + minAge
      } else {
        age = Math.floor(Math.random() * 30) + 20
      }

      const tags: string[] = []
      if (age < 30) tags.push("Z世代")
      else if (age < 40) tags.push("职场中坚")
      else tags.push("资深人士")
      
      if (config.income.includes("50万以上") || config.income.includes("30-50")) tags.push("高端消费")
      else if (config.income.includes("10-15") || config.income.includes("15-20")) tags.push("理性消费")
      
      if (config.occupation.includes("工程师") || config.occupation.includes("程序员")) tags.push("科技爱好者")
      if (config.occupation.includes("设计")) tags.push("文艺青年")
      if (config.occupation.includes("经理") || config.occupation.includes("总监")) tags.push("商务精英")

      result.push({
        id: `resp-${String(globalIndex).padStart(3, '0')}`,
        name: namePool[Math.floor(Math.random() * namePool.length)],
        nickname: nicknames[Math.floor(Math.random() * nicknames.length)],
        avatar: avatars[Math.floor(Math.random() * avatars.length)],
        age,
        gender: isMale ? "男" : "女",
        occupation: config.occupation || "自由职业",
        city: config.city || "北京",
        income: config.income || "10-15万",
        education: educations[Math.floor(Math.random() * educations.length)],
        maritalStatus: maritalStatuses[Math.floor(Math.random() * maritalStatuses.length)],
        tags,
        configId: config.id,
      })
    }
  })

  return result
}

// Interview response types
type InterviewResponseResult = 
  | { type: "answer"; message: DialogMessage; shouldTerminate: false }
  | { type: "terminated_by_respondent"; message: DialogMessage; reason: string; shouldTerminate: true }
  | { type: "low_quality_response"; message: DialogMessage; shouldTerminate: false }

// Mock method: Send question and get response
export async function askQuestion(
  respondent: RespondentProfile,
  question: SurveyQuestion,
  previousDialog: DialogMessage[]
): Promise<InterviewResponseResult> {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 800))

  // 10% chance respondent wants to terminate
  if (Math.random() < 0.1 && previousDialog.length > 2) {
    const terminationPhrases = [
      "不好意思，我有点急事要处理，能改天再聊吗？",
      "抱歉，时间有点紧，我得先走了。",
      "我觉得问得差不多了，后面的问题我就不回答了。",
      "说实话，有些问题我不太想回答，就这样吧。"
    ]
    
    return {
      type: "terminated_by_respondent",
      message: {
        id: `msg-${Date.now()}`,
        role: "respondent",
        content: terminationPhrases[Math.floor(Math.random() * terminationPhrases.length)],
        timestamp: new Date(),
        sentiment: "negative"
      },
      reason: "受访者主动结束对话",
      shouldTerminate: true
    }
  }

  const response = generatePersonalizedResponse(respondent, question)
  const isLowQuality = Math.random() < 0.15 && previousDialog.length > 4
  
  return {
    type: isLowQuality ? "low_quality_response" : "answer",
    message: response,
    shouldTerminate: false
  }
}

// Generate personalized response based on respondent profile
function generatePersonalizedResponse(
  respondent: RespondentProfile,
  question: SurveyQuestion
): DialogMessage {
  let content: string
  let answerValue: string | number | undefined
  
  const sentiments: Array<"positive" | "neutral" | "negative"> = ["positive", "neutral", "negative"]
  const sentimentWeights = [0.4, 0.35, 0.25]
  const rand = Math.random()
  let sentiment: "positive" | "neutral" | "negative" = "neutral"
  let cumulative = 0
  for (let i = 0; i < sentimentWeights.length; i++) {
    cumulative += sentimentWeights[i]
    if (rand < cumulative) {
      sentiment = sentiments[i]
      break
    }
  }

  switch (question.type) {
    case "scale": {
      const min = question.scale?.min || 1
      const max = question.scale?.max || 10
      let score: number
      if (sentiment === "positive") {
        score = Math.floor(Math.random() * 3) + (max - 2)
      } else if (sentiment === "negative") {
        score = Math.floor(Math.random() * 3) + min
      } else {
        score = Math.floor(Math.random() * 3) + Math.floor((max - min) / 2)
      }
      score = Math.min(max, Math.max(min, score))
      answerValue = score
      
      const scaleResponses = [
        `作为一个${respondent.occupation}，我给${score}分。${score >= 7 ? '整体体验还是不错的。' : score >= 4 ? '有些地方还可以改进。' : '确实有较大的提升空间。'}`,
        `嗯...我打${score}分吧。${respondent.tags.includes('理性消费') ? '这是基于我实际使用感受的客观评价。' : '这是我个人的直观感受。'}`,
        `${score}分。在${respondent.city}这边，大家对这类产品的期望还是挺高的。`
      ]
      content = scaleResponses[Math.floor(Math.random() * scaleResponses.length)]
      break
    }
    
    case "choice": {
      const options = question.options || []
      const selectedIndex = Math.floor(Math.random() * options.length)
      const selectedOption = options[selectedIndex]
      answerValue = selectedOption
      
      const choiceResponses = [
        `我选"${selectedOption}"。作为${respondent.age}岁的${respondent.gender}性用户，这个选项最符合我的习惯。`,
        `"${selectedOption}"吧。${respondent.tags[0] ? `毕竟我算是${respondent.tags[0]}，` : ''}这个比较适合我。`,
        `我的选择是"${selectedOption}"。主要是因为我的工作性质（${respondent.occupation}）让我更倾向于这个。`
      ]
      content = choiceResponses[Math.floor(Math.random() * choiceResponses.length)]
      break
    }
    
    default: {
      answerValue = "text_response"
      const textResponses = [
        `从我个人角度来说，作为在${respondent.city}工作的${respondent.occupation}，我觉得最重要的是能够提升效率。现在工作节奏快，产品如果能帮我节省时间就太好了。`,
        `说实话，${respondent.income}的收入水平让我在消费时会考虑性价比。我希望产品能物有所值，不要有太多华而不实的功能。`,
        `我觉得用户体验很重要。我${respondent.education}毕业，对产品的设计和交互有一定要求，希望能更加人性化。`,
        `作为一个${respondent.maritalStatus}的人，我在选择产品时会考虑${respondent.maritalStatus.includes('有孩') ? '家庭成员的需求' : '自己的实际使用场景'}。`,
        `${respondent.tags.includes('科技爱好者') ? '我一直关注新技术，' : '虽然我不是特别技术派，但'}希望产品能够持续更新迭代。`
      ]
      content = textResponses[Math.floor(Math.random() * textResponses.length)]
    }
  }

  return {
    id: `msg-${Date.now()}-${respondent.id}`,
    role: "respondent",
    content,
    timestamp: new Date(),
    questionId: question.id,
    sentiment,
    answerValue
  }
}

// Mock method: Check if interviewer should terminate
export function shouldInterviewerTerminate(
  dialog: DialogMessage[],
  lastResponse: InterviewResponseResult
): { shouldTerminate: boolean; reason?: string } {
  if (lastResponse.type === "low_quality_response") {
    if (Math.random() < 0.5) {
      return {
        shouldTerminate: true,
        reason: "受访者回答质量较低，调研方决定提前结束"
      }
    }
  }
  
  const recentMessages = dialog.slice(-4).filter(m => m.role === "respondent")
  const negativeCount = recentMessages.filter(m => m.sentiment === "negative").length
  if (negativeCount >= 3) {
    if (Math.random() < 0.3) {
      return {
        shouldTerminate: true,
        reason: "受访者态度消极，调研方决定终止访谈"
      }
    }
  }
  
  return { shouldTerminate: false }
}

// Analyze sentiment from sessions
export function analyzeSentiment(sessions: InterviewSession[]): SentimentData {
  const counts = { positive: 0, neutral: 0, negative: 0 }
  let total = 0

  sessions.forEach(session => {
    session.dialog.forEach(msg => {
      if (msg.role === "respondent" && msg.sentiment) {
        counts[msg.sentiment]++
        total++
      }
    })
  })

  total = total || 1
  return {
    positive: Math.round((counts.positive / total) * 100),
    neutral: Math.round((counts.neutral / total) * 100),
    negative: Math.round((counts.negative / total) * 100)
  }
}

// Analyze responses by question
export interface QuestionAnalysis {
  questionId: string
  questionText: string
  questionType: "text" | "choice" | "scale"
  totalResponses: number
  responseDistribution: Record<string, number>
  averageScore?: number
}

export function analyzeQuestionResponses(
  sessions: InterviewSession[],
  questions: SurveyQuestion[]
): QuestionAnalysis[] {
  return questions.map(q => {
    const responses: Array<string | number> = []
    const distribution: Record<string, number> = {}
    
    sessions.forEach(session => {
      session.dialog.forEach(msg => {
        if (msg.questionId === q.id && msg.role === "respondent" && msg.answerValue !== undefined) {
          responses.push(msg.answerValue)
          const key = String(msg.answerValue)
          distribution[key] = (distribution[key] || 0) + 1
        }
      })
    })

    let averageScore: number | undefined
    if (q.type === "scale" && responses.length > 0) {
      const numericResponses = responses.filter((r): r is number => typeof r === "number")
      averageScore = numericResponses.reduce((a, b) => a + b, 0) / numericResponses.length
    }

    return {
      questionId: q.id,
      questionText: q.question,
      questionType: q.type,
      totalResponses: responses.length,
      responseDistribution: distribution,
      averageScore
    }
  })
}

// Analyze by demographic tags
export interface DemographicAnalysis {
  tagName: string
  questionId: string
  questionText: string
  responseDistribution: Record<string, number>
  respondentCount: number
}

export function analyzeByDemographics(
  sessions: InterviewSession[],
  respondents: RespondentProfile[],
  questions: SurveyQuestion[]
): DemographicAnalysis[] {
  const result: DemographicAnalysis[] = []
  
  const cities = [...new Set(respondents.map(r => r.city))]
  const incomes = [...new Set(respondents.map(r => r.income))]

  questions.forEach(q => {
    cities.forEach(city => {
      const cityRespondents = respondents.filter(r => r.city === city)
      const distribution: Record<string, number> = {}
      let count = 0

      cityRespondents.forEach(respondent => {
        const session = sessions.find(s => s.respondentId === respondent.id)
        if (session) {
          session.dialog.forEach(msg => {
            if (msg.questionId === q.id && msg.role === "respondent" && msg.answerValue !== undefined) {
              const key = String(msg.answerValue)
              distribution[key] = (distribution[key] || 0) + 1
              count++
            }
          })
        }
      })

      if (count > 0) {
        result.push({
          tagName: city,
          questionId: q.id,
          questionText: q.question,
          responseDistribution: distribution,
          respondentCount: count
        })
      }
    })

    incomes.forEach(income => {
      const incomeRespondents = respondents.filter(r => r.income === income)
      const distribution: Record<string, number> = {}
      let count = 0

      incomeRespondents.forEach(respondent => {
        const session = sessions.find(s => s.respondentId === respondent.id)
        if (session) {
          session.dialog.forEach(msg => {
            if (msg.questionId === q.id && msg.role === "respondent" && msg.answerValue !== undefined) {
              const key = String(msg.answerValue)
              distribution[key] = (distribution[key] || 0) + 1
              count++
            }
          })
        }
      })

      if (count > 0) {
        result.push({
          tagName: `收入:${income}`,
          questionId: q.id,
          questionText: q.question,
          responseDistribution: distribution,
          respondentCount: count
        })
      }
    })
  })

  return result
}

// Export survey results
export async function exportSurveyResults(
  sessions: InterviewSession[],
  respondents: RespondentProfile[],
  format: "json" | "csv"
): Promise<Blob> {
  await new Promise(resolve => setTimeout(resolve, 300))

  const data = {
    exportedAt: new Date().toISOString(),
    totalRespondents: respondents.length,
    completedInterviews: sessions.filter(s => s.status === "completed").length,
    sessions: sessions.map(s => ({
      respondentId: s.respondentId,
      status: s.status,
      terminationReason: s.terminationReason,
      completedQuestions: s.completedQuestions,
      dialog: s.dialog
    })),
    respondents
  }

  if (format === "json") {
    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  }

  const rows = ["respondentId,name,city,status,completedQuestions,terminationReason"]
  sessions.forEach(s => {
    const respondent = respondents.find(r => r.id === s.respondentId)
    rows.push(`${s.respondentId},${respondent?.name || ''},${respondent?.city || ''},${s.status},${s.completedQuestions},${s.terminationReason || ''}`)
  })

  return new Blob([rows.join("\n")], { type: "text/csv" })
}

// Default respondent configs
export const defaultRespondentConfigs: RespondentConfig[] = [
  {
    id: "config-1",
    gender: "男",
    ageRange: "25-35",
    occupation: "产品经理",
    city: "北京",
    income: "20-30万",
    count: 3
  },
  {
    id: "config-2",
    gender: "女",
    ageRange: "22-30",
    occupation: "软件工程师",
    city: "上海",
    income: "15-25万",
    count: 2
  },
  {
    id: "config-3",
    gender: "不限",
    ageRange: "30-45",
    occupation: "企业高管",
    city: "深圳",
    income: "50万以上",
    count: 2
  }
]

// Default survey config
export const defaultSurveyConfig: SurveyConfig = {
  title: "用户体验调研",
  description: "了解用户对产品的使用体验和改进建议",
  maxResponseTime: 30,
  respondentConfigs: defaultRespondentConfigs,
  questions: [
    {
      id: "q1",
      type: "scale",
      question: "请评价您对该产品的整体满意度（1-10分）",
      scale: { min: 1, max: 10 }
    },
    {
      id: "q2",
      type: "choice",
      question: "您最常使用哪个功能？",
      options: ["搜索功能", "推荐系统", "个人中心", "社交分享"]
    },
    {
      id: "q3",
      type: "text",
      question: "您认为产品最需要改进的地方是什么？"
    },
    {
      id: "q4",
      type: "choice",
      question: "您会向朋友推荐这个产品吗？",
      options: ["一定会", "可能会", "不确定", "可能不会", "一定不会"]
    },
    {
      id: "q5",
      type: "text",
      question: "请分享您最近一次使用产品的体验"
    }
  ]
}

export const respondentDimensionKeys = [
  "gender",
  "ageRange",
  "occupation",
  "city",
  "income",
] as const

export type RespondentDimensionKey = (typeof respondentDimensionKeys)[number]

const dimensionLabels: Record<RespondentDimensionKey, string> = {
  gender: "性别",
  ageRange: "年龄段",
  occupation: "职业",
  city: "工作城市",
  income: "收入区间",
}

type RespondentConfigMap = Record<string, RespondentConfig>

function buildConfigMap(configs: RespondentConfig[]): RespondentConfigMap {
  return configs.reduce((map, config) => {
    map[config.id] = config
    return map
  }, {} as RespondentConfigMap)
}

function getRespondentDimensionValue(
  respondent: RespondentProfile,
  configs: RespondentConfig[],
  key: RespondentDimensionKey,
): string {
  const configMap = buildConfigMap(configs)
  const config = configMap[respondent.configId]

  switch (key) {
    case "gender":
      return respondent.gender || config?.gender || "Unknown"
    case "ageRange":
      return config?.ageRange || "Unknown"
    case "occupation":
      return respondent.occupation || config?.occupation || "Unknown"
    case "city":
      return respondent.city || config?.city || "Unknown"
    case "income":
      return respondent.income || config?.income || "Unknown"
  }
}

export interface DimensionMetadata {
  key: RespondentDimensionKey
  label: string
  values: string[]
}

export function getDimensionMetadata(
  respondents: RespondentProfile[],
  configs: RespondentConfig[],
): DimensionMetadata[] {
  const valueSets: Record<RespondentDimensionKey, Set<string>> = respondentDimensionKeys.reduce(
    (acc, key) => {
      acc[key] = new Set<string>()
      return acc
    },
    {} as Record<RespondentDimensionKey, Set<string>>,
  )

  configs.forEach(config => {
    respondentDimensionKeys.forEach(key => {
      let value = "Unknown"
      switch (key) {
        case "gender":
          value = config.gender || "Unknown"
          break
        case "ageRange":
          value = config.ageRange || "Unknown"
          break
        case "occupation":
          value = config.occupation || "Unknown"
          break
        case "city":
          value = config.city || "Unknown"
          break
        case "income":
          value = config.income || "Unknown"
          break
      }
      valueSets[key].add(value)
    })
  })

  respondents.forEach(respondent => {
    respondentDimensionKeys.forEach(key => {
      const value = getRespondentDimensionValue(respondent, configs, key)
      valueSets[key].add(value || "Unknown")
    })
  })

  return respondentDimensionKeys.map(key => ({
    key,
    label: dimensionLabels[key],
    values: Array.from(valueSets[key]).filter(Boolean),
  }))
}

export type DimensionFilters = Partial<Record<RespondentDimensionKey, string>>

export function filterRespondentsByDimensions(
  respondents: RespondentProfile[],
  configs: RespondentConfig[],
  filters: DimensionFilters,
): RespondentProfile[] {
  if (!filters || Object.keys(filters).length === 0) {
    return respondents
  }

  return respondents.filter(respondent => {
    return Object.entries(filters).every(([key, value]) => {
      if (!value) return true
      const dimensionKey = key as RespondentDimensionKey
      const dimensionValue = getRespondentDimensionValue(respondent, configs, dimensionKey)
      return dimensionValue === value
    })
  })
}

export interface DimensionGroup {
  groupKey: string
  label: string
  respondentIds: string[]
  dimensionValues: Record<RespondentDimensionKey, string>
}

export function groupRespondentsByDimensions(
  respondents: RespondentProfile[],
  configs: RespondentConfig[],
  groupBy: RespondentDimensionKey[],
): DimensionGroup[] {
  if (groupBy.length === 0) {
    return []
  }

  const bucketMap: Record<string, DimensionGroup> = {}

  respondents.forEach(respondent => {
    const dimensionValues: Record<RespondentDimensionKey, string> = groupBy.reduce(
      (acc, key) => {
        acc[key] = getRespondentDimensionValue(respondent, configs, key)
        return acc
      },
      {} as Record<RespondentDimensionKey, string>,
    )

    const keyParts = groupBy.map(key => key + ": " + dimensionValues[key]).join("|")
    if (!bucketMap[keyParts]) {
      bucketMap[keyParts] = {
        groupKey: keyParts,
        label: groupBy
          .map(key => dimensionLabels[key] + ": " + dimensionValues[key])
          .join(" / "),
        respondentIds: [],
        dimensionValues,
      }
    }

    bucketMap[keyParts].respondentIds.push(respondent.id)
  })

  return Object.values(bucketMap)
}
