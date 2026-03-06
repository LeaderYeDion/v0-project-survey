// Mock Survey Service
// This file contains mock methods that simulate backend communication
// Replace these methods with actual API calls when integrating with a real backend

export interface SurveyConfig {
  title: string
  description: string
  questions: SurveyQuestion[]
  agentCount: number
  maxResponseTime: number
}

export interface SurveyQuestion {
  id: string
  type: "text" | "choice" | "scale"
  question: string
  options?: string[]
  scale?: { min: number; max: number }
}

// Extended respondent profile with detailed demographics
export interface RespondentProfile {
  id: string
  name: string
  nickname: string
  avatar: string
  age: number
  gender: "男" | "女"
  occupation: string
  city: string
  income: string  // 收入区间
  education: string
  maritalStatus: string
  tags: string[]  // 额外标签
}

export interface DialogMessage {
  id: string
  role: "interviewer" | "respondent"
  content: string
  timestamp: Date
  questionId?: string
  sentiment?: "positive" | "neutral" | "negative"
  answerValue?: string | number  // 用于统计的答案值
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

// Mock respondent data - simulating backend response
const mockRespondentProfiles: RespondentProfile[] = [
  {
    id: "resp-001",
    name: "张伟",
    nickname: "大伟",
    avatar: "👨‍💼",
    age: 32,
    gender: "男",
    occupation: "产品经理",
    city: "北京",
    income: "30-50万",
    education: "本科",
    maritalStatus: "已婚",
    tags: ["科技爱好者", "职场精英", "理性消费"]
  },
  {
    id: "resp-002",
    name: "李娜",
    nickname: "娜娜",
    avatar: "👩‍💻",
    age: 28,
    gender: "女",
    occupation: "软件工程师",
    city: "上海",
    income: "20-30万",
    education: "硕士",
    maritalStatus: "未婚",
    tags: ["Z世代", "数码控", "独立女性"]
  },
  {
    id: "resp-003",
    name: "王芳",
    nickname: "芳芳",
    avatar: "👩‍🎨",
    age: 35,
    gender: "女",
    occupation: "自由设计师",
    city: "杭州",
    income: "15-20万",
    education: "本科",
    maritalStatus: "已婚有孩",
    tags: ["文艺青年", "品质生活", "育儿族"]
  },
  {
    id: "resp-004",
    name: "陈强",
    nickname: "强哥",
    avatar: "👨‍🔬",
    age: 45,
    gender: "男",
    occupation: "企业高管",
    city: "深圳",
    income: "50万以上",
    education: "MBA",
    maritalStatus: "已婚有孩",
    tags: ["商务精英", "高端消费", "投资理财"]
  },
  {
    id: "resp-005",
    name: "刘洋",
    nickname: "小洋",
    avatar: "👨‍🎤",
    age: 24,
    gender: "男",
    occupation: "市场专员",
    city: "成都",
    income: "10-15万",
    education: "本科",
    maritalStatus: "未婚",
    tags: ["Z世代", "潮流追随者", "社交达人"]
  },
  {
    id: "resp-006",
    name: "赵敏",
    nickname: "敏敏",
    avatar: "👩‍⚕️",
    age: 38,
    gender: "女",
    occupation: "医生",
    city: "广州",
    income: "30-50万",
    education: "博士",
    maritalStatus: "已婚",
    tags: ["健康养生", "专业人士", "稳健消费"]
  },
  {
    id: "resp-007",
    name: "孙磊",
    nickname: "磊子",
    avatar: "👨‍🍳",
    age: 29,
    gender: "男",
    occupation: "创业者",
    city: "南京",
    income: "20-30万",
    education: "本科",
    maritalStatus: "未婚",
    tags: ["创业精神", "风险偏好", "行动派"]
  },
  {
    id: "resp-008",
    name: "周琳",
    nickname: "琳琳",
    avatar: "👩‍🏫",
    age: 42,
    gender: "女",
    occupation: "大学教师",
    city: "武汉",
    income: "15-20万",
    education: "博士",
    maritalStatus: "已婚有孩",
    tags: ["知识分子", "教育关注", "理性消费"]
  }
]

// Mock method: Fetch respondent list from backend
export async function fetchRespondentList(count: number): Promise<RespondentProfile[]> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 600))
  
  // Return requested number of respondents (循环使用mock数据)
  const result: RespondentProfile[] = []
  for (let i = 0; i < count; i++) {
    const template = mockRespondentProfiles[i % mockRespondentProfiles.length]
    result.push({
      ...template,
      id: `resp-${String(i + 1).padStart(3, '0')}`
    })
  }
  return result
}

// Mock method: Start interview with a respondent
export async function startInterview(respondentId: string): Promise<InterviewSession> {
  await new Promise(resolve => setTimeout(resolve, 300))
  
  return {
    respondentId,
    status: "in_progress",
    dialog: [],
    completedQuestions: 0,
    totalQuestions: 0,
    startTime: new Date()
  }
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
  // Simulate thinking time
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

  // Generate response based on question type and respondent profile
  const response = generatePersonalizedResponse(respondent, question)
  
  // 15% chance of low quality response that might trigger interviewer termination
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
      // Score influenced by sentiment
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

// Mock method: Check if interviewer should terminate (based on response quality)
export function shouldInterviewerTerminate(
  dialog: DialogMessage[],
  lastResponse: InterviewResponseResult
): { shouldTerminate: boolean; reason?: string } {
  if (lastResponse.type === "low_quality_response") {
    // 50% chance interviewer decides to terminate after low quality response
    if (Math.random() < 0.5) {
      return {
        shouldTerminate: true,
        reason: "受访者回答质量较低，调研方决定提前结束"
      }
    }
  }
  
  // Check for pattern of negative responses
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
  
  // Group by city
  const cities = [...new Set(respondents.map(r => r.city))]
  // Group by age range
  const ageRanges = ["20-30岁", "30-40岁", "40-50岁"]
  // Group by income
  const incomes = [...new Set(respondents.map(r => r.income))]

  // Analyze by city for each question
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

    // Analyze by income
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

  // CSV format
  const rows = ["respondentId,name,city,status,completedQuestions,terminationReason"]
  sessions.forEach(s => {
    const respondent = respondents.find(r => r.id === s.respondentId)
    rows.push(`${s.respondentId},${respondent?.name || ''},${respondent?.city || ''},${s.status},${s.completedQuestions},${s.terminationReason || ''}`)
  })

  return new Blob([rows.join("\n")], { type: "text/csv" })
}

// Default survey config
export const defaultSurveyConfig: SurveyConfig = {
  title: "用户体验调研",
  description: "了解用户对产品的使用体验和改进建议",
  agentCount: 8,
  maxResponseTime: 30,
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
