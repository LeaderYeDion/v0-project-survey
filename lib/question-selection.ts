export interface QuestionIdentifier {
  id: string
}

export function selectValidQuestionId(
  current: string,
  questions: readonly QuestionIdentifier[],
): string {
  return questions.some(question => question.id === current)
    ? current
    : questions[0]?.id ?? ""
}
