import { END, createAgentExecute } from "pi-loop-graph-sdk";
import type {
  CompletionValidationResult,
  Edge,
  Entry,
  Graph,
  Node,
} from "pi-loop-graph-sdk";
import type { DifficultyLevel, GradeResult, ReviewQuestion } from "../domain/types.js";
import { loadActiveStudyContext } from "../domain/study-profile.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

const questionOutputSchema = {
  type: "object",
  properties: {
    question_id: { type: "string" },
    knowledge_points: { type: "array", items: { type: "string" } },
    difficulty: { type: "string" },
    type: { enum: ["choice", "multi_choice", "judgment", "short_answer"] },
    question_text: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    correct_answer: { type: "string" },
    explanation_l1: { type: "string" },
    source_basis: { type: "string" },
    related_knowledge_chain: { type: "array", items: { type: "string" } },
  },
  required: [
    "question_id",
    "knowledge_points",
    "difficulty",
    "type",
    "question_text",
    "correct_answer",
    "explanation_l1",
    "source_basis",
    "related_knowledge_chain",
  ],
  additionalProperties: false,
};

const gradeOutputSchema = {
  type: "object",
  properties: {
    is_correct: { type: "boolean" },
    correct_answer: { type: "string" },
    explanation_l1: { type: "string" },
    knowledge_chain_l3: { type: "array", items: { type: "string" } },
    suggestion_next: { type: "string" },
    grading: { type: "string" },
  },
  required: [
    "is_correct",
    "correct_answer",
    "explanation_l1",
    "knowledge_chain_l3",
    "suggestion_next",
    "grading",
  ],
  additionalProperties: false,
};

const summaryOutputSchema = {
  type: "object",
  properties: {
    summary_markdown: { type: "string" },
    weak_points: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["summary_markdown", "weak_points", "strengths", "recommendations"],
  additionalProperties: false,
};

const discussionOutputSchema = {
  type: "object",
  properties: {
    reply: { type: "string" },
    clarified_points: { type: "array", items: { type: "string" } },
    lingering_questions: { type: "array", items: { type: "string" } },
  },
  required: ["reply", "clarified_points", "lingering_questions"],
  additionalProperties: false,
};

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

export function validateQuestionResult(result: Record<string, unknown>): CompletionValidationResult {
  const types = new Set(["choice", "multi_choice", "judgment", "short_answer"]);
  const requiredStrings = ["question_id", "difficulty", "type", "question_text", "correct_answer", "explanation_l1", "source_basis"];
  for (const key of requiredStrings) {
    if (!validString(result[key])) return { isValid: false, reason: `${key} 必须是非空字符串` };
  }
  if (!types.has(String(result.type))) return { isValid: false, reason: "type 不是支持的题型" };
  if (!validStringArray(result.knowledge_points)) return { isValid: false, reason: "knowledge_points 必须是非空字符串数组" };
  if (!Array.isArray(result.related_knowledge_chain) || result.related_knowledge_chain.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "related_knowledge_chain 必须是字符串数组" };
  }
  if ((result.type === "choice" || result.type === "multi_choice") && !validStringArray(result.options)) {
    return { isValid: false, reason: "选择题必须提供非空 options" };
  }
  return { isValid: true };
}

export function validateGradeResult(result: Record<string, unknown>): CompletionValidationResult {
  if (typeof result.is_correct !== "boolean") return { isValid: false, reason: "is_correct 必须是布尔值" };
  for (const key of ["correct_answer", "explanation_l1", "suggestion_next", "grading"]) {
    if (!validString(result[key])) return { isValid: false, reason: `${key} 必须是非空字符串` };
  }
  if (!Array.isArray(result.knowledge_chain_l3) || result.knowledge_chain_l3.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "knowledge_chain_l3 必须是字符串数组" };
  }
  return { isValid: true };
}

export function validateSummaryResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.summary_markdown)) return { isValid: false, reason: "summary_markdown 不能为空" };
  for (const key of ["weak_points", "strengths", "recommendations"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string")) {
      return { isValid: false, reason: `${key} 必须是字符串数组` };
    }
  }
  return { isValid: true };
}

export function validateDiscussionResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.reply)) return { isValid: false, reason: "reply 不能为空" };
  for (const key of ["clarified_points", "lingering_questions"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string")) {
      return { isValid: false, reason: `${key} 必须是字符串数组` };
    }
  }
  return { isValid: true };
}

function finishEdge(from: string): Edge {
  return {
    id: `${from}_to_end`,
    from,
    to: END,
    priority: 10,
    guard: () => true,
    migrate(_instance, completion) {
      return {
        frame: { [`${from}Result`]: completion.result },
        output: { status: completion.status, result: completion.result },
      };
    },
  };
}

function singleNodeEntry(startNodeId: string): Entry {
  return { id: "main", guard: () => true, startNodeId, mapInput: (background) => background };
}

export interface StudyWalkingSkeletonGraphs {
  generateQuestion: Graph;
  gradeAnswer: Graph;
  discussQuestion: Graph;
  summarizeSession: Graph;
}

export function createStudyWalkingSkeletonGraphs(
  profiles: ProfileFamilyRepository,
): StudyWalkingSkeletonGraphs {
  const prepareNode: Node = {
    kind: "code",
    id: "prepare_question_context",
    subGoal: "从 active Profile 准备出题上下文",
    tools: [],
    async execute(_instance, input) {
      const subjectId = String(input.data.subjectId ?? "");
      const scopeId = String(input.data.scopeId ?? "");
      const context = await loadActiveStudyContext(profiles, subjectId, scopeId);
      return {
        nodeId: "prepare_question_context",
        status: "ok",
        result: {
          subjectId,
          profileName: context.profile.name,
          scopeId,
          scopeLabel: context.scope.label,
          knowledgePointIds: context.scope.knowledgePointIds,
          difficulty: String(input.data.difficulty ?? "S-U"),
          questionType: String(input.data.questionType ?? "short_answer"),
          mode: String(input.data.mode ?? "practice"),
          material: context.material,
        },
      };
    },
  };

  const generateNode: Node = {
    kind: "code",
    id: "generate_question",
    subGoal: "严格依据 active Profile 生成一道可判定的学习题",
    tools: [],
    execute: createAgentExecute({
      outputSchema: questionOutputSchema,
      validateCompletion: validateQuestionResult,
      prompt: (input) => `你是学习出题者。只依据下面资料生成一道题，不得引入资料外事实。\n\n要求：\n1. 难度为 ${String(input.data.difficulty)}，题型为 ${String(input.data.questionType)}，学习方式为 ${String(input.data.mode)}。\n2. 题目必须有明确答案和简洁解析。\n3. source_basis 写实际使用的资料依据。\n4. 完成后调用 __graph_complete__，结果严格符合输出 schema。\n\n可用知识点：${JSON.stringify(input.data.knowledgePointIds)}\n范围：${String(input.data.scopeLabel)}\n\n资料：\n${String(input.data.material)}`,
    }),
  };

  const prepareToGenerate: Edge = {
    id: "prepare_to_generate",
    from: "prepare_question_context",
    to: "generate_question",
    priority: 10,
    guard: (completion) => completion.status === "ok",
    migrate(_instance, completion) {
      return {
        frame: { preparedQuestionContext: { ...completion.result, material: "[已传给出题节点]" } },
        input: completion.result,
      };
    },
  };

  const generateQuestion: Graph = {
    id: "study_generate_question",
    goal: "从 active Profile 生成一道学习题",
    entries: [singleNodeEntry("prepare_question_context")],
    nodes: { prepare_question_context: prepareNode, generate_question: generateNode },
    routing: {
      prepare_question_context: { nodeId: "prepare_question_context", edges: [prepareToGenerate], router: { kind: "first-match" } },
      generate_question: { nodeId: "generate_question", edges: [finishEdge("generate_question")], router: { kind: "first-match" } },
    },
  };

  const gradeNode: Node = {
    kind: "code",
    id: "grade_answer",
    subGoal: "根据题目标准答案和资料语义判断用户回答",
    tools: [],
    execute: createAgentExecute({
      outputSchema: gradeOutputSchema,
      validateCompletion: validateGradeResult,
      prompt: (input) => `请判定用户回答。不要只做字面匹配；根据题目、标准答案和解析判断核心意思是否正确。用户明确放弃时判为错误。完成后调用 __graph_complete__。\n\n题目：${JSON.stringify(input.data.question)}\n用户回答：${String(input.data.userAnswer)}`,
    }),
  };
  const gradeAnswer: Graph = {
    id: "study_grade_answer",
    goal: "语义判断一次学习回答",
    entries: [singleNodeEntry("grade_answer")],
    nodes: { grade_answer: gradeNode },
    routing: { grade_answer: { nodeId: "grade_answer", edges: [finishEdge("grade_answer")], router: { kind: "first-match" } } },
  };

  const discussionNode: Node = {
    kind: "code",
    id: "discuss_question",
    subGoal: "围绕当前题目帮助用户澄清概念，不脱离 active Profile 证据",
    tools: [],
    execute: createAgentExecute({
      outputSchema: discussionOutputSchema,
      validateCompletion: validateDiscussionResult,
      prompt: (input) => `你是学习讨论伙伴。根据题目、解析、判题结果和用户追问进行解释，帮助用户自己消化知识。不要另起无关话题，不要虚构资料依据。完成后调用 __graph_complete__。\n\n题目：${JSON.stringify(input.data.question)}\n最近判题：${JSON.stringify(input.data.grade)}\n用户追问：${String(input.data.userMessage)}`,
    }),
  };
  const discussQuestion: Graph = {
    id: "study_discuss_question",
    goal: "围绕当前题目完成一次知识消化讨论",
    entries: [singleNodeEntry("discuss_question")],
    nodes: { discuss_question: discussionNode },
    routing: { discuss_question: { nodeId: "discuss_question", edges: [finishEdge("discuss_question")], router: { kind: "first-match" } } },
  };

  const summaryNode: Node = {
    kind: "code",
    id: "summarize_session",
    subGoal: "生成必须持久化的本次学习情况总结",
    tools: [],
    execute: createAgentExecute({
      outputSchema: summaryOutputSchema,
      validateCompletion: validateSummaryResult,
      prompt: (input) => `根据本次会话与答题记录生成中文 Markdown 学习情况总结。必须包含：学习范围、作答表现、掌握点、薄弱点、下一步建议。只总结已有证据，不虚构长期画像。完成后调用 __graph_complete__。\n\n会话：${JSON.stringify(input.data.session)}\n答题记录：${JSON.stringify(input.data.attempts)}`,
    }),
  };
  const summarizeSession: Graph = {
    id: "study_summarize_session",
    goal: "形成一次学习会话的学习情况总结",
    entries: [singleNodeEntry("summarize_session")],
    nodes: { summarize_session: summaryNode },
    routing: { summarize_session: { nodeId: "summarize_session", edges: [finishEdge("summarize_session")], router: { kind: "first-match" } } },
  };

  return { generateQuestion, gradeAnswer, discussQuestion, summarizeSession };
}

export function asReviewQuestion(result: Record<string, unknown>): ReviewQuestion & { question_id: string } {
  const validation = validateQuestionResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ReviewQuestion & { question_id: string };
}

export function asGradeResult(result: Record<string, unknown>): GradeResult {
  const validation = validateGradeResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as GradeResult;
}

export function difficultyFrom(value: string): DifficultyLevel {
  const allowed = new Set<DifficultyLevel>(["S-R", "S-U", "M-U", "M-A", "C-A"]);
  if (!allowed.has(value as DifficultyLevel)) throw new Error(`Unsupported difficulty: ${value}`);
  return value as DifficultyLevel;
}
