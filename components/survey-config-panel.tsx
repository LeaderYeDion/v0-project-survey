"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Play, Plus, Trash2, FileJson, Settings2, Users } from "lucide-react"
import type { SurveyConfig, SurveyQuestion } from "@/lib/mock-survey-service"

interface SurveyConfigPanelProps {
  config: SurveyConfig
  onConfigChange: (config: SurveyConfig) => void
  onStartSimulation: () => void
  isRunning: boolean
}

export function SurveyConfigPanel({
  config,
  onConfigChange,
  onStartSimulation,
  isRunning
}: SurveyConfigPanelProps) {
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonError, setJsonError] = useState<string | null>(null)

  const updateQuestion = (index: number, updates: Partial<SurveyQuestion>) => {
    const newQuestions = [...config.questions]
    newQuestions[index] = { ...newQuestions[index], ...updates }
    onConfigChange({ ...config, questions: newQuestions })
  }

  const addQuestion = () => {
    const newQuestion: SurveyQuestion = {
      id: `q${config.questions.length + 1}`,
      type: "text",
      question: ""
    }
    onConfigChange({ ...config, questions: [...config.questions, newQuestion] })
  }

  const removeQuestion = (index: number) => {
    const newQuestions = config.questions.filter((_, i) => i !== index)
    onConfigChange({ ...config, questions: newQuestions })
  }

  const handleJsonChange = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      setJsonError(null)
      onConfigChange(parsed)
    } catch {
      setJsonError("JSON 格式错误")
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">调研配置</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setJsonMode(!jsonMode)}
          className="text-muted-foreground hover:text-foreground"
        >
          <FileJson className="w-4 h-4 mr-1" />
          {jsonMode ? "表单" : "JSON"}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-4">
        {jsonMode ? (
          <div className="space-y-3">
            <Label className="text-muted-foreground">调研配置 JSON</Label>
            <Textarea
              className="min-h-[400px] font-mono text-sm bg-background/50 border-border/50 text-foreground"
              value={JSON.stringify(config, null, 2)}
              onChange={(e) => handleJsonChange(e.target.value)}
            />
            {jsonError && (
              <p className="text-sm text-destructive">{jsonError}</p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-muted-foreground">调研标题</Label>
                <Input
                  id="title"
                  value={config.title}
                  onChange={(e) => onConfigChange({ ...config, title: e.target.value })}
                  className="bg-background/50 border-border/50 text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-muted-foreground">调研描述</Label>
                <Textarea
                  id="description"
                  value={config.description}
                  onChange={(e) => onConfigChange({ ...config, description: e.target.value })}
                  className="bg-background/50 border-border/50 text-foreground"
                  rows={2}
                />
              </div>
            </div>

            {/* Agent Settings */}
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/30 space-y-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">虚拟代理设置</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">代理数量</Label>
                  <Badge variant="secondary" className="bg-primary/20 text-primary">
                    {config.agentCount}
                  </Badge>
                </div>
                <Slider
                  value={[config.agentCount]}
                  onValueChange={([value]) => onConfigChange({ ...config, agentCount: value })}
                  max={20}
                  min={1}
                  step={1}
                  className="w-full"
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">最大响应时间(秒)</Label>
                  <Badge variant="secondary" className="bg-accent/20 text-accent">
                    {config.maxResponseTime}s
                  </Badge>
                </div>
                <Slider
                  value={[config.maxResponseTime]}
                  onValueChange={([value]) => onConfigChange({ ...config, maxResponseTime: value })}
                  max={120}
                  min={5}
                  step={5}
                  className="w-full"
                />
              </div>
            </div>

            {/* Questions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">问题列表</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addQuestion}
                  className="text-primary hover:text-primary/80"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  添加
                </Button>
              </div>

              <Accordion type="multiple" className="space-y-2">
                {config.questions.map((question, index) => (
                  <AccordionItem
                    key={question.id}
                    value={question.id}
                    className="border border-border/30 rounded-lg bg-secondary/20 px-4"
                  >
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-3 text-left">
                        <Badge variant="outline" className="text-xs border-border/50 text-muted-foreground">
                          Q{index + 1}
                        </Badge>
                        <span className="text-sm text-foreground truncate max-w-[180px]">
                          {question.question || "未设置问题"}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">问题类型</Label>
                        <Select
                          value={question.type}
                          onValueChange={(value: "text" | "choice" | "scale") =>
                            updateQuestion(index, { type: value })
                          }
                        >
                          <SelectTrigger className="bg-background/50 border-border/50 text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">文本回答</SelectItem>
                            <SelectItem value="choice">选择题</SelectItem>
                            <SelectItem value="scale">评分量表</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">问题内容</Label>
                        <Textarea
                          value={question.question}
                          onChange={(e) => updateQuestion(index, { question: e.target.value })}
                          className="bg-background/50 border-border/50 text-foreground"
                          rows={2}
                        />
                      </div>
                      {question.type === "choice" && (
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">选项（每行一个）</Label>
                          <Textarea
                            value={question.options?.join("\n") || ""}
                            onChange={(e) =>
                              updateQuestion(index, {
                                options: e.target.value.split("\n").filter(Boolean)
                              })
                            }
                            className="bg-background/50 border-border/50 text-foreground"
                            rows={4}
                          />
                        </div>
                      )}
                      {question.type === "scale" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">最小值</Label>
                            <Input
                              type="number"
                              value={question.scale?.min || 1}
                              onChange={(e) =>
                                updateQuestion(index, {
                                  scale: { ...question.scale!, min: parseInt(e.target.value) }
                                })
                              }
                              className="bg-background/50 border-border/50 text-foreground"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">最大值</Label>
                            <Input
                              type="number"
                              value={question.scale?.max || 10}
                              onChange={(e) =>
                                updateQuestion(index, {
                                  scale: { ...question.scale!, max: parseInt(e.target.value) }
                                })
                              }
                              className="bg-background/50 border-border/50 text-foreground"
                            />
                          </div>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeQuestion(index)}
                        className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        删除问题
                      </Button>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t border-border/50">
        <Button
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={onStartSimulation}
          disabled={isRunning || config.questions.length === 0}
        >
          {isRunning ? (
            <>
              <div className="w-4 h-4 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              运行中...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              开始模拟
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
