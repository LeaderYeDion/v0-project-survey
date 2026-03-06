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

export interface VirtualAgent {
  id: string
  name: string
  avatar: string
  persona: string
  demographics: {
    age: number
    gender: string
    location: string
    occupation: string
  }
}

export interface ChatMessage {
  id: string
  agentId: string
  agentName: string
  agentAvatar: string
  content: string
  timestamp: Date
  sentiment: "positive" | "neutral" | "negative"
  questionId: string
}

export interface SurveyProgress {
  totalAgents: number
  completedAgents: number
  currentQuestion: number
  totalQuestions: number
  estimatedTimeRemaining: number
}

export interface SentimentData {
  positive: number
  neutral: number
  negative: number
}

// Mock data generators
const avatars = [
  "👨‍💼", "👩‍💻", "👨‍🎨", "👩‍🔬", "👨‍🏫", "👩‍⚕️", "👨‍🍳", "👩‍🎤"
]

const firstNames = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery"]
const lastNames = ["Chen", "Kim", "Patel", "Singh", "Williams", "Brown", "Garcia", "Martinez"]
const occupations = ["软件工程师", "产品经理", "设计师", "数据分析师", "市场专员", "运营经理", "研究员", "咨询顾问"]
const locations = ["北京", "上海", "深圳", "杭州", "成都", "广州", "南京", "武汉"]
const personas = [
  "注重效率的职场精英",
  "追求品质生活的年轻白领",
  "谨慎务实的家庭主妇",
  "热爱尝鲜的科技爱好者",
  "注重性价比的理性消费者",
  "追求个性化的Z世代",
  "经验丰富的行业专家",
  "关注健康的养生达人"
]

// Mock method: Generate virtual agents
export async function generateVirtualAgents(count: number): Promise<VirtualAgent[]> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500))

  return Array.from({ length: count }, (_, i) => ({
    id: `agent-${i + 1}`,
    name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
    avatar: avatars[i % avatars.length],
    persona: personas[i % personas.length],
    demographics: {
      age: Math.floor(Math.random() * 30) + 22,
      gender: Math.random() > 0.5 ? "男" : "女",
      location: locations[i % locations.length],
      occupation: occupations[i % occupations.length]
    }
  }))
}

// Mock method: Start survey simulation
export async function startSurveySimulation(
  config: SurveyConfig
): Promise<{ sessionId: string; agents: VirtualAgent[] }> {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 800))

  const agents = await generateVirtualAgents(config.agentCount)

  return {
    sessionId: `session-${Date.now()}`,
    agents
  }
}

// Mock method: Generate a single agent response
export async function generateAgentResponse(
  agent: VirtualAgent,
  question: SurveyQuestion
): Promise<ChatMessage> {
  // Simulate thinking time
  await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))

  const responses: Record<string, string[]> = {
    text: [
      "我认为这个问题很有意思，从我的角度来看...",
      "根据我的经验，我觉得...",
      "这是一个很好的问题，让我想想...",
      "从${occupation}的视角来说，我认为...",
      "作为一个${persona}，我的看法是..."
    ],
    choice: [
      "我选择第${n}个选项，因为它最符合我的需求",
      "经过考虑，我倾向于选择${option}",
      "对我来说，${option}是最合适的选择"
    ],
    scale: [
      "我给出${n}分，因为整体体验${quality}",
      "考虑到各方面因素，我的评分是${n}",
      "基于我的使用经历，${n}分比较合理"
    ]
  }

  const responseTemplates = responses[question.type] || responses.text
  let content = responseTemplates[Math.floor(Math.random() * responseTemplates.length)]

  // Replace placeholders
  content = content
    .replace("${occupation}", agent.demographics.occupation)
    .replace("${persona}", agent.persona)
    .replace("${n}", String(Math.floor(Math.random() * 5) + 1))
    .replace("${option}", question.options?.[Math.floor(Math.random() * (question.options?.length || 1))] || "")
    .replace("${quality}", Math.random() > 0.5 ? "还不错" : "有待提升")

  // Determine sentiment based on content patterns
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

  return {
    id: `msg-${Date.now()}-${agent.id}`,
    agentId: agent.id,
    agentName: agent.name,
    agentAvatar: agent.avatar,
    content,
    timestamp: new Date(),
    sentiment,
    questionId: question.id
  }
}

// Mock method: Get survey progress
export async function getSurveyProgress(sessionId: string): Promise<SurveyProgress> {
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 100))

  // This would normally track actual progress
  return {
    totalAgents: 8,
    completedAgents: Math.floor(Math.random() * 8),
    currentQuestion: Math.floor(Math.random() * 5) + 1,
    totalQuestions: 5,
    estimatedTimeRemaining: Math.floor(Math.random() * 120) + 30
  }
}

// Mock method: Analyze sentiment from messages
export function analyzeSentiment(messages: ChatMessage[]): SentimentData {
  const counts = { positive: 0, neutral: 0, negative: 0 }

  messages.forEach(msg => {
    counts[msg.sentiment]++
  })

  const total = messages.length || 1
  return {
    positive: Math.round((counts.positive / total) * 100),
    neutral: Math.round((counts.neutral / total) * 100),
    negative: Math.round((counts.negative / total) * 100)
  }
}

// Mock method: Export survey results
export async function exportSurveyResults(
  sessionId: string,
  format: "json" | "csv"
): Promise<Blob> {
  await new Promise(resolve => setTimeout(resolve, 500))

  // Mock export data
  const data = {
    sessionId,
    exportedAt: new Date().toISOString(),
    results: []
  }

  if (format === "json") {
    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  }

  return new Blob(["sessionId,exportedAt\n" + sessionId + "," + data.exportedAt], {
    type: "text/csv"
  })
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
      question: "请评价您对该产品的整体满意度",
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
