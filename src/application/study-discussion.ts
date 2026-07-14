import type { GradeResult, ReviewQuestion } from "../domain/types.js";

export interface DiscussionAgentInput extends Record<string, unknown> {
  question: Record<string, unknown>;
  grade: Record<string, unknown>;
  userAnswer: string;
  userMessage: string;
  revealAnswer: boolean;
}

/**
 * 订正前只投影安全题面；题目结束后才允许参考答案和解析进入讨论 Agent。
 */
export function buildDiscussionAgentInput(
  question: ReviewQuestion & { question_id: string },
  grade: GradeResult | undefined,
  userAnswer: string,
  userMessage: string,
  revealAnswer: boolean,
): DiscussionAgentInput {
  if (revealAnswer) {
    return {
      question: { ...question },
      grade: grade ? { ...grade } : {},
      userAnswer,
      userMessage,
      revealAnswer: true,
    };
  }

  return {
    question: {
      question_id: question.question_id,
      knowledge_points: question.knowledge_points,
      difficulty: question.difficulty,
      type: question.type,
      question_text: question.question_text,
      options: question.options,
    },
    grade: {
      is_correct: false,
      grading: "回答尚未完全正确；只允许提供渐进提示。",
    },
    userAnswer,
    userMessage,
    revealAnswer: false,
  };
}
