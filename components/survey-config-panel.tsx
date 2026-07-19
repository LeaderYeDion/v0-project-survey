"use client"

import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
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
import { Play, Plus, Trash2, FileJson, Settings2, UserPlus, Users, ClipboardList } from "lucide-react"
import type {
  AttitudeInferenceTask,
  InferenceConfig,
  ProfileInferenceTask,
  RespondentConfig,
  SurveyConfig,
  SurveyQuestion,
} from "@/lib/survey-api"
import { createDefaultInferenceConfig } from "@/lib/survey-api"
import { useI18n } from "@/components/locale-provider"

interface SurveyConfigPanelProps {
  config: SurveyConfig
  onConfigChange: (config: SurveyConfig) => void
  onStartSimulation: () => void
  isRunning: boolean
  mode: "interview" | "survey"
}

export function SurveyConfigPanel({
  config,
  onConfigChange,
  onStartSimulation,
  isRunning,
  mode,
}: SurveyConfigPanelProps) {
  const { messages } = useI18n()
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonError, setJsonError] = useState(false)
  const inferenceConfig = config.inferenceConfig ?? createDefaultInferenceConfig()

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

  const updateRespondentConfig = (index: number, updates: Partial<RespondentConfig>) => {
    const newConfigs = [...config.respondentConfigs]
    newConfigs[index] = { ...newConfigs[index], ...updates }
    onConfigChange({ ...config, respondentConfigs: newConfigs })
  }

  const addRespondentConfig = () => {
    const newConfig: RespondentConfig = {
      id: `config-${Date.now()}`,
      gender: "不限",
      ageRange: "25-35",
      occupation: "",
      city: "",
      income: "",
      count: 1
    }
    onConfigChange({ 
      ...config, 
      respondentConfigs: [...config.respondentConfigs, newConfig] 
    })
  }

  const removeRespondentConfig = (index: number) => {
    const newConfigs = config.respondentConfigs.filter((_, i) => i !== index)
    onConfigChange({ ...config, respondentConfigs: newConfigs })
  }

  const updateInferenceConfig = (updates: Partial<InferenceConfig>) => {
    const nextConfig = { ...inferenceConfig, ...updates }
    onConfigChange({ ...config, inferenceConfig: nextConfig })
  }

  const updateProfileTask = (index: number, updates: Partial<ProfileInferenceTask>) => {
    const profileTasks = [...inferenceConfig.profileTasks]
    profileTasks[index] = { ...profileTasks[index], ...updates }
    updateInferenceConfig({ profileTasks })
  }

  const updateAttitudeTask = (index: number, updates: Partial<AttitudeInferenceTask>) => {
    const attitudeTasks = [...inferenceConfig.attitudeTasks]
    attitudeTasks[index] = { ...attitudeTasks[index], ...updates }
    updateInferenceConfig({ attitudeTasks })
  }

  const addProfileTask = () => {
    const defaultOptions =
      createDefaultInferenceConfig().profileTasks[0]?.options.slice(0, 2) ?? []
    updateInferenceConfig({
      profileTasks: [
        ...inferenceConfig.profileTasks,
        {
          id: `profile-${Date.now()}`,
          name: "",
          options: defaultOptions,
          multiple: false,
          enabled: true,
        },
      ],
    })
  }

  const addAttitudeTask = () => {
    const defaultOptions =
      createDefaultInferenceConfig().attitudeTasks[0]?.options ?? []
    updateInferenceConfig({
      attitudeTasks: [
        ...inferenceConfig.attitudeTasks,
        {
          id: `attitude-${Date.now()}`,
          name: "",
          options: defaultOptions,
          enabled: true,
        },
      ],
    })
  }

  const totalRespondents = config.respondentConfigs.reduce((sum, c) => sum + c.count, 0)
  const countEnabledTasks = (tasks: { enabled: boolean }[]) =>
    tasks.filter((task) => task.enabled).length
  const enabledInferenceTasks =
    countEnabledTasks(inferenceConfig.profileTasks) +
    countEnabledTasks(inferenceConfig.attitudeTasks)
  const totalInferenceTasks =
    inferenceConfig.profileTasks.length + inferenceConfig.attitudeTasks.length

  const handleJsonChange = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      setJsonError(false)
      onConfigChange(parsed)
    } catch {
      setJsonError(true)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border/50 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-2">
          {mode === "interview" ? (
            <Settings2 className="w-5 h-5 text-primary" />
          ) : (
            <ClipboardList className="w-5 h-5 text-primary" />
          )}
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-semibold text-foreground">
              {mode === "interview"
                ? messages.config.interviewTitle
                : messages.config.surveyTitle}
            </h2>
            <span className="truncate text-[11px] text-muted-foreground">
              {mode === "interview"
                ? messages.config.interviewDescription
                : messages.config.surveyDescription}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setJsonMode(!jsonMode)}
          className="text-muted-foreground hover:text-foreground"
        >
          <FileJson className="w-4 h-4 mr-1" />
          {jsonMode ? messages.config.form : messages.common.json}
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1 p-3 sm:p-4">
        {jsonMode ? (
          <div className="space-y-3">
            <Label
              htmlFor="survey-config-json"
              className="text-muted-foreground"
            >
              {messages.config.configurationJson}
            </Label>
            <Textarea
              id="survey-config-json"
              aria-invalid={jsonError}
              aria-describedby={
                jsonError ? "survey-config-json-error" : undefined
              }
              className="min-h-[400px] font-mono text-sm bg-background/50 border-border/50 text-foreground"
              value={JSON.stringify(config, null, 2)}
              onChange={(e) => handleJsonChange(e.target.value)}
            />
            {jsonError && (
              <p
                id="survey-config-json-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {messages.errors.invalidJson}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-muted-foreground">
                  {messages.config.surveyTitleLabel}
                </Label>
                <Input
                  id="title"
                  value={config.title}
                  onChange={(e) => onConfigChange({ ...config, title: e.target.value })}
                  className="bg-background/50 border-border/50 text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-muted-foreground">
                  {messages.config.surveyDescriptionLabel}
                </Label>
                <Textarea
                  id="description"
                  value={config.description}
                  onChange={(e) => onConfigChange({ ...config, description: e.target.value })}
                  className="bg-background/50 border-border/50 text-foreground"
                  rows={2}
                />
              </div>
            </div>

            {/* Response Time Setting */}
            <div className="p-4 rounded-lg bg-secondary/30 border border-border/30 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">
                  {messages.config.maxResponseTime}
                </Label>
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

            {/* Questions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">
                  {messages.config.questionList}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={addQuestion}
                  className="text-primary hover:text-primary/80"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {messages.common.add}
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
                      <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <Badge variant="outline" className="text-xs border-border/50 text-muted-foreground">
                          Q{index + 1}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {question.question || messages.config.unsetQuestion}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pb-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">
                          {messages.config.questionType}
                        </Label>
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
                            <SelectItem value="text">
                              {messages.config.textAnswer}
                            </SelectItem>
                            <SelectItem value="choice">
                              {messages.config.choiceQuestion}
                            </SelectItem>
                            <SelectItem value="scale">
                              {messages.config.ratingScale}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">
                          {messages.config.questionContent}
                        </Label>
                        <Textarea
                          value={question.question}
                          onChange={(e) => updateQuestion(index, { question: e.target.value })}
                          className="bg-background/50 border-border/50 text-foreground"
                          rows={2}
                        />
                      </div>
                      {question.type === "choice" && (
                        <div className="space-y-2">
                          <Label className="text-muted-foreground text-xs">
                            {messages.config.optionsPerLine}
                          </Label>
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
                            <Label className="text-muted-foreground text-xs">
                              {messages.config.minimum}
                            </Label>
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
                            <Label className="text-muted-foreground text-xs">
                              {messages.config.maximum}
                            </Label>
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
                        {messages.config.deleteQuestion}
                      </Button>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>

            {/* Respondent Configs - Collapsible */}
            <Accordion type="single" collapsible defaultValue="respondent-configs">
              <AccordionItem
                value="respondent-configs"
                className="border border-border/30 rounded-lg bg-secondary/10"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-2">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">
                        {messages.config.respondentConfiguration}
                      </span>
                    </div>
                    <Badge variant="secondary" className="bg-primary/20 text-primary">
                      {messages.config.respondentGroupSummary(
                        config.respondentConfigs.length,
                        totalRespondents,
                      )}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-3">
                    {/* Add button */}
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={addRespondentConfig}
                        className="text-primary hover:text-primary/80"
                      >
                        <UserPlus className="w-4 h-4 mr-1" />
                        {messages.config.addConfigurationGroup}
                      </Button>
                    </div>

                    {/* Scrollable config list */}
                    <div className="max-h-[280px] overflow-y-auto pr-1 space-y-3 scrollbar-thin">
                      {config.respondentConfigs.map((respConfig, index) => (
                        <div
                          key={respConfig.id}
                          className="p-3 rounded-lg bg-secondary/20 border border-border/30 space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="text-xs border-primary/30 text-primary">
                              {messages.config.configurationNumber(index + 1)}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRespondentConfig(index)}
                              aria-label={messages.config.deleteConfigurationGroup(
                                index + 1,
                              )}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.gender}
                              </Label>
                              <Input
                                value={respConfig.gender}
                                onChange={(e) => updateRespondentConfig(index, { gender: e.target.value })}
                                placeholder={messages.config.genderPlaceholder}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.ageRange}
                              </Label>
                              <Input
                                value={respConfig.ageRange}
                                onChange={(e) => updateRespondentConfig(index, { ageRange: e.target.value })}
                                placeholder={messages.config.ageRangePlaceholder}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.occupation}
                              </Label>
                              <Input
                                value={respConfig.occupation}
                                onChange={(e) => updateRespondentConfig(index, { occupation: e.target.value })}
                                placeholder={messages.config.occupationPlaceholder}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.workCity}
                              </Label>
                              <Input
                                value={respConfig.city}
                                onChange={(e) => updateRespondentConfig(index, { city: e.target.value })}
                                placeholder={messages.config.cityPlaceholder}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.income}
                              </Label>
                              <Input
                                value={respConfig.income}
                                onChange={(e) => updateRespondentConfig(index, { income: e.target.value })}
                                placeholder={messages.config.incomePlaceholder}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px]">
                                {messages.config.generatedCount}
                              </Label>
                              <Input
                                type="number"
                                value={respConfig.count}
                                onChange={(e) => updateRespondentConfig(index, { count: parseInt(e.target.value) || 1 })}
                                min={1}
                                className="h-8 text-xs bg-background/50 border-border/50 text-foreground"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {mode === "interview" && (
              <Accordion type="single" collapsible defaultValue="inference-tasks">
                <AccordionItem
                  value="inference-tasks"
                  className="rounded-lg border border-border/30 bg-secondary/10"
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex w-full min-w-0 items-center justify-between gap-3 pr-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Settings2 className="h-4 w-4 text-primary" />
                        <div className="min-w-0 text-left">
                          <span className="block font-medium text-foreground">
                            {messages.config.inferenceTasks}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {messages.config.enabledTaskCount(
                              enabledInferenceTasks,
                              totalInferenceTasks,
                            )}
                          </span>
                        </div>
                      </div>
                      <Badge variant="secondary" className="bg-primary/20 text-primary">
                        {inferenceConfig.enabled
                          ? messages.common.enabled
                          : messages.common.disabled}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 px-4 pb-4">
                    <div className="space-y-3 rounded-md border border-border/30 bg-background/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Label className="text-sm text-foreground">
                            {messages.config.enableInferenceTasks}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {messages.config.inferenceDescription}
                          </p>
                        </div>
                        <Switch
                          checked={inferenceConfig.enabled}
                          onCheckedChange={(enabled) => updateInferenceConfig({ enabled })}
                        />
                      </div>
                      <p className="rounded-md bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                        {messages.config.inferenceOutputHint}
                      </p>
                      {inferenceConfig.enabled && enabledInferenceTasks === 0 && (
                        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          {messages.config.noEnabledTasks}
                        </p>
                      )}
                    </div>

                    {inferenceConfig.enabled && (
                      <div className="space-y-4">
                        <InferenceTaskGroup
                          title={messages.config.profileInference}
                          description={messages.config.profileInferenceDescription}
                          enabled={inferenceConfig.profileEnabled}
                          enabledTaskCount={countEnabledTasks(inferenceConfig.profileTasks)}
                          totalTaskCount={inferenceConfig.profileTasks.length}
                          enabledTaskCountLabel={messages.config.enabledTaskCount}
                          noEnabledTasks={messages.config.noEnabledTasks}
                          onEnabledChange={(profileEnabled) => updateInferenceConfig({ profileEnabled })}
                          onAdd={addProfileTask}
                          addLabel={messages.config.addProfileTask}
                        >
                          {inferenceConfig.profileTasks.map((task, index) => (
                            <InferenceTaskEditor
                              key={task.id}
                              name={task.name}
                              enabled={task.enabled}
                              options={task.options}
                              multiple={task.multiple}
                              showMultiple
                              taskNameLabel={messages.config.taskName}
                              optionsLabel={messages.config.taskOptions}
                              multipleLabel={messages.config.allowMultipleValues}
                              onNameChange={(name) => updateProfileTask(index, { name })}
                              onEnabledChange={(enabled) => updateProfileTask(index, { enabled })}
                              onOptionsChange={(options) => updateProfileTask(index, { options })}
                              onMultipleChange={(multiple) => updateProfileTask(index, { multiple })}
                              onRemove={() =>
                                updateInferenceConfig({
                                  profileTasks: inferenceConfig.profileTasks.filter((_, taskIndex) => taskIndex !== index),
                                })
                              }
                            />
                          ))}
                        </InferenceTaskGroup>

                        <InferenceTaskGroup
                          title={messages.config.attitudeInference}
                          description={messages.config.attitudeInferenceDescription}
                          enabled={inferenceConfig.attitudeEnabled}
                          enabledTaskCount={countEnabledTasks(inferenceConfig.attitudeTasks)}
                          totalTaskCount={inferenceConfig.attitudeTasks.length}
                          enabledTaskCountLabel={messages.config.enabledTaskCount}
                          noEnabledTasks={messages.config.noEnabledTasks}
                          onEnabledChange={(attitudeEnabled) => updateInferenceConfig({ attitudeEnabled })}
                          onAdd={addAttitudeTask}
                          addLabel={messages.config.addAttitudeTask}
                        >
                          {inferenceConfig.attitudeTasks.map((task, index) => (
                            <InferenceTaskEditor
                              key={task.id}
                              name={task.name}
                              enabled={task.enabled}
                              options={task.options}
                              taskNameLabel={messages.config.taskName}
                              optionsLabel={messages.config.taskOptions}
                              multipleLabel={messages.config.allowMultipleValues}
                              onNameChange={(name) => updateAttitudeTask(index, { name })}
                              onEnabledChange={(enabled) => updateAttitudeTask(index, { enabled })}
                              onOptionsChange={(options) => updateAttitudeTask(index, { options })}
                              onRemove={() =>
                                updateInferenceConfig({
                                  attitudeTasks: inferenceConfig.attitudeTasks.filter((_, taskIndex) => taskIndex !== index),
                                })
                              }
                            />
                          ))}
                        </InferenceTaskGroup>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="shrink-0 border-t border-border/50 bg-card/95 p-3 backdrop-blur sm:p-4">
        <Button
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={onStartSimulation}
          disabled={isRunning || config.questions.length === 0 || totalRespondents === 0}
        >
          {isRunning ? (
            <>
              <div className="w-4 h-4 mr-2 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              {mode === "interview"
                ? messages.config.interviewRunning
                : messages.config.surveyDistributing}
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              {mode === "interview"
                ? messages.config.startInterview
                : messages.config.startSurvey}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function InferenceTaskGroup({
  title,
  description,
  enabled,
  enabledTaskCount,
  totalTaskCount,
  enabledTaskCountLabel,
  noEnabledTasks,
  onEnabledChange,
  onAdd,
  addLabel,
  children,
}: {
  title: string
  description: string
  enabled: boolean
  enabledTaskCount: number
  totalTaskCount: number
  enabledTaskCountLabel: (enabled: number | string, total: number | string) => string
  noEnabledTasks: string
  onEnabledChange: (enabled: boolean) => void
  onAdd: () => void
  addLabel: string
  children: ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/30 bg-secondary/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            className="mt-0.5"
          />
          <div className="min-w-0 space-y-1">
            <Label className="text-sm text-foreground">{title}</Label>
            <p className="text-xs text-muted-foreground">{description}</p>
            <Badge variant="outline" className="text-[10px] font-normal">
              {enabledTaskCountLabel(enabledTaskCount, totalTaskCount)}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          {addLabel}
        </Button>
      </div>
      {enabled && enabledTaskCount === 0 && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {noEnabledTasks}
        </p>
      )}
      {enabled && <div className="space-y-3">{children}</div>}
    </div>
  )
}

function InferenceTaskEditor({
  name,
  enabled,
  options,
  multiple,
  showMultiple = false,
  taskNameLabel,
  optionsLabel,
  multipleLabel,
  onNameChange,
  onEnabledChange,
  onOptionsChange,
  onMultipleChange,
  onRemove,
}: {
  name: string
  enabled: boolean
  options: string[]
  multiple?: boolean
  showMultiple?: boolean
  taskNameLabel: string
  optionsLabel: string
  multipleLabel: string
  onNameChange: (name: string) => void
  onEnabledChange: (enabled: boolean) => void
  onOptionsChange: (options: string[]) => void
  onMultipleChange?: (multiple: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-2 rounded-md border border-border/30 bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-2">
          <Checkbox
            checked={enabled}
            onCheckedChange={(value) => onEnabledChange(value === true)}
            className="mt-7"
          />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              {taskNameLabel}
            </Label>
            <Input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              className="h-8 bg-background/50 text-xs"
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          {optionsLabel}
        </Label>
        <Textarea
          value={options.join("\n")}
          onChange={(event) =>
            onOptionsChange(
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
          className="min-h-20 bg-background/50 text-xs"
        />
      </div>
      {showMultiple && onMultipleChange && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={multiple} onCheckedChange={(value) => onMultipleChange(value === true)} />
          {multipleLabel}
        </label>
      )}
    </div>
  )
}
