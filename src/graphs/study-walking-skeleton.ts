import { END, createAgentExecute } from "pi-loop-graph-sdk";
import type {
  CompletionValidationResult,
  Edge,
  Entry,
  Graph,
  Node,
} from "pi-loop-graph-sdk";
import type { DifficultyLevel, GradeResult, ReviewQuestion } from "../domain/types.js";
import type { LearningProfileCandidate } from "../domain/learning-profile-evidence.js";
import { loadActiveStudyTargetContext, type StudyTargetKind } from "../domain/study-profile.js";
import { getDifficultyPolicy, getReviewModePolicy } from "../domain/study-policy.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

const questionOutputSchema = {
  type: "object",
  properties: {
    question_id: { type: "string" },
    knowledge_points: { type: "array", items: { type: "string" } },
    difficulty: { type: "string" },
    type: { enum: ["choice", "judgment", "short_answer"] },
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
    observed_facts: { type: "array", items: { type: "string" } },
    mastery_evidence: { type: "array", items: { type: "string" } },
    unverified_topics: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["summary_markdown", "observed_facts", "mastery_evidence", "unverified_topics", "recommendations"],
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

const learningProfileOutputSchema = {
  type: "object",
  properties: {
    profile_summary: { type: "string" },
    weak_points: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
    unverified_topics: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["profile_summary", "weak_points", "strengths", "unverified_topics", "recommendations"],
  additionalProperties: false,
};

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(validString);
}

export function validateQuestionResult(result: Record<string, unknown>): CompletionValidationResult {
  const types = new Set(["choice", "judgment", "short_answer"]);
  const difficulties = new Set(["S-R", "S-U", "M-U", "M-A", "C-A"]);
  const requiredStrings = ["question_id", "difficulty", "type", "question_text", "correct_answer", "explanation_l1", "source_basis"];
  for (const key of requiredStrings) {
    if (!validString(result[key])) return { isValid: false, reason: `${key} 必须是非空字符串` };
  }
  if (!types.has(String(result.type))) return { isValid: false, reason: "type 不是支持的题型" };
  if (!difficulties.has(String(result.difficulty))) return { isValid: false, reason: "difficulty 不是支持的难度" };
  if (!validStringArray(result.knowledge_points)) return { isValid: false, reason: "knowledge_points 必须是非空字符串数组" };
  if (!Array.isArray(result.related_knowledge_chain) || result.related_knowledge_chain.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "related_knowledge_chain 必须是字符串数组" };
  }
  if (result.type === "choice" && (!validStringArray(result.options) || result.options.length < 2 || result.options.length > 6)) {
    return { isValid: false, reason: "choice 必须提供 2 到 6 个非空选项" };
  }
  return { isValid: true };
}

export function validateQuestionResultForRequest(
  result: Record<string, unknown>,
  expectedDifficulty: string,
  expectedType: string,
  allowedKnowledgePointIds: readonly string[] = [],
  exactKnowledgePointId?: string,
): CompletionValidationResult {
  const base = validateQuestionResult(result);
  if (!base.isValid) return base;
  if (result.difficulty !== expectedDifficulty) {
    return { isValid: false, reason: `difficulty 必须与用户选择一致：${expectedDifficulty}` };
  }
  if (result.type !== expectedType) {
    return { isValid: false, reason: `type 必须与用户选择一致：${expectedType}` };
  }
  const actualKnowledgePoints = result.knowledge_points as string[];
  if (allowedKnowledgePointIds.length > 0 && actualKnowledgePoints.some((item) => !allowedKnowledgePointIds.includes(item))) {
    return { isValid: false, reason: "knowledge_points 超出当前学习目标" };
  }
  if (exactKnowledgePointId !== undefined && (
    actualKnowledgePoints.length !== 1 || actualKnowledgePoints[0] !== exactKnowledgePointId
  )) {
    return { isValid: false, reason: `卡片练习必须只考查当前卡片：${exactKnowledgePointId}` };
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
  for (const key of ["observed_facts", "mastery_evidence", "unverified_topics", "recommendations"]) {
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

export function validateLearningProfileResult(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.profile_summary)) return { isValid: false, reason: "profile_summary 不能为空" };
  if (String(result.profile_summary).length > 2_000) return { isValid: false, reason: "profile_summary 过长" };
  for (const key of ["weak_points", "strengths", "unverified_topics", "recommendations"]) {
    const values = result[key];
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string" || item.trim() === "")) {
      return { isValid: false, reason: `${key} 必须是非空字符串数组` };
    }
    if (values.length > 20 || values.some((item) => item.length > 200)) {
      return { isValid: false, reason: `${key} 超出画像长度限制` };
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
  updateLearningProfile: Graph;
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
      const targetKind = String(input.data.targetKind ?? "scope") as StudyTargetKind;
      if (!(["scope", "card", "section"] as const).includes(targetKind)) {
        throw new Error(`Unsupported study target kind: ${targetKind}`);
      }
      const targetId = String(input.data.targetId ?? scopeId);
      const difficulty = String(input.data.difficulty ?? "S-U");
      const mode = String(input.data.mode ?? "practice");
      const context = await loadActiveStudyTargetContext(profiles, subjectId, scopeId, targetKind, targetId);
      const difficultyPolicy = getDifficultyPolicy(difficulty);
      const modePolicy = getReviewModePolicy(mode);
      return {
        nodeId: "prepare_question_context",
        status: "ok",
        result: {
          subjectId,
          profileName: context.profile.name,
          scopeId,
          scopeLabel: context.scope.label,
          target: context.target,
          knowledgePointIds: context.target.knowledgePointIds,
          difficulty,
          difficultyPolicy,
          questionType: String(input.data.questionType ?? "short_answer"),
          mode,
          modePolicy,
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
    execute(instance, input, ctx) {
      const expectedDifficulty = String(input.data.difficulty);
      const expectedType = String(input.data.questionType);
      const allowedKnowledgePointIds = Array.isArray(input.data.knowledgePointIds)
        ? input.data.knowledgePointIds.filter((item): item is string => typeof item === "string")
        : [];
      const target = input.data.target as { kind?: unknown; id?: unknown } | undefined;
      const exactKnowledgePointId = target?.kind === "card" && typeof target.id === "string" ? target.id : undefined;
      return createAgentExecute({
        outputSchema: questionOutputSchema,
        validateCompletion: (result) => validateQuestionResultForRequest(
          result,
          expectedDifficulty,
          expectedType,
          allowedKnowledgePointIds,
          exactKnowledgePointId,
        ),
        prompt: (nextInput) => `你是学习出题者。只依据下面资料和固定策略生成一道题，不得引入资料外事实。\n\n固定难度策略：${JSON.stringify(nextInput.data.difficultyPolicy)}\n固定学习方式策略：${JSON.stringify(nextInput.data.modePolicy)}\n当前学习目标：${JSON.stringify(nextInput.data.target)}\n\n要求：\n1. 难度必须为 ${String(nextInput.data.difficulty)}，题型必须为 ${String(nextInput.data.questionType)}。\n2. 题目必须遵守上述策略，有明确答案和简洁解析。\n3. knowledge_points 只能使用当前目标允许的 ID；卡片练习只能使用当前卡片 ID。\n4. source_basis 写实际使用的资料依据。\n5. 不得逐字复用资料中的现成题目或答案。\n6. 完成后调用 __graph_complete__，结果严格符合输出 schema。\n\n可用知识点：${JSON.stringify(nextInput.data.knowledgePointIds)}\n范围：${String(nextInput.data.scopeLabel)}\n\n资料：\n${String(nextInput.data.material)}`,
      })(instance, input, ctx);
    },
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
      prompt: (input) => `请判定用户提交的答案。不要只做字面匹配；根据题目、标准答案和解析判断核心意思是否正确。\n\n业务约束：\n1. 传入文本一定是 submitted_answer，不是放弃动作。\n2. 即使回答是“不知道”、空泛回答或答非所问，也只能判为错误，不能描述为“用户放弃”。\n3. 只评价这次回答的知识内容，不推断信心、焦虑、态度、习惯或长期能力。\n4. 完成后调用 __graph_complete__。\n\n题目：${JSON.stringify(input.data.question)}\n用户回答：${String(input.data.userAnswer)}`,
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
      prompt: (input) => {
        const revealAnswer = input.data.revealAnswer === true;
        const completionAttempt = Number(input.data.completionAttempt ?? 1);
        const policy = revealAnswer
          ? "本题已经结束，可以使用给定的参考答案和解析进行完整解释。"
          : "本题仍在订正中。只能提供渐进提示、追问或指出思考方向；不得给出完整答案、参考答案、解析、判分点组合，也不得复述任何未提供的隐藏答案。即使用户直接询问答案，也要引导其继续作答。";
        const retryReminder = completionAttempt > 1
          ? "这是结构化提交重试。上一次没有形成节点结果，本次不得只输出普通正文。"
          : "";
        return `你正在执行一个必须结构化完成的学习讨论节点。${policy}\n\n${retryReminder}\n最高优先级输出要求：无论是否拒绝直接给答案，都必须调用 __graph_complete__；把面向用户的内容写入 reply，并同时提交 clarified_points 与 lingering_questions 两个字符串数组。不要在普通正文中结束本轮。\n\n不要另起无关话题，不要虚构资料依据，不推断用户心理或长期能力。\n\n题目上下文：${JSON.stringify(input.data.question)}\n最近判题上下文：${JSON.stringify(input.data.grade)}\n用户最近提交：${String(input.data.userAnswer ?? "")}\n用户追问：${String(input.data.userMessage)}`;
      },
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
      prompt: (input) => `根据代码生成的 SessionEvidence 生成中文 Markdown 学习情况总结。必须包含：学习范围、可观察事实、掌握证据、未获得掌握证据的内容、下一步建议。\n\n证据规则：\n1. 只能使用 evidence 中的字段，不得补写原始答案、心理状态、习惯或长期能力。\n2. mastery_evidence 才能支持掌握结论；clarified_points 只表示讨论涉及的内容。\n3. unverified_topics 只表示没有获得掌握证据，不能改写为薄弱点或错误知识。\n4. 建议只能使用给定的有效难度目录，不得发明等级。\n5. 输出数组必须分别对应可观察事实、掌握证据、未验证主题和建议。\n6. 完成后调用 __graph_complete__。\n\n总结类型：${String(input.data.summaryKind ?? "final")}\n有效难度目录：${JSON.stringify(input.data.difficultyCatalog)}\nSessionEvidence：${JSON.stringify(input.data.evidence)}`,
    }),
  };
  const summarizeSession: Graph = {
    id: "study_summarize_session",
    goal: "形成一次学习会话的学习情况总结",
    entries: [singleNodeEntry("summarize_session")],
    nodes: { summarize_session: summaryNode },
    routing: { summarize_session: { nodeId: "summarize_session", edges: [finishEdge("summarize_session")], router: { kind: "first-match" } } },
  };

  const learningProfileNode: Node = {
    kind: "code",
    id: "update_learning_profile",
    subGoal: "根据用户选中的学习记录更新长期学习画像候选",
    tools: [],
    execute: createAgentExecute({
      outputSchema: learningProfileOutputSchema,
      validateCompletion: validateLearningProfileResult,
      prompt: (input) => `根据代码提供的 LearningProfileEvidence 生成中文长期学习画像候选。

规则：
1. 只使用 existing_profile、selected_batches 及其中的 summary_excerpt/session_evidence，不读取或猜测原始回答。
2. strengths 只能来自 mastery_evidence；unverified_topics 表示尚未获得掌握证据，不能自动等同于 weak_points。
3. weak_points 只能保留 existing_profile 已有项，或由多个已选会话中的重复订正/重复未验证证据支持；单次放弃不能直接定性为薄弱。
4. profile_summary 概括累计画像，不写心理、性格、信心、习惯或长期能力猜测。
5. recommendations 必须具体但保守，优先使用 evidence 中已经出现的范围、目标、知识点和有效难度。
6. 不要计算累计题数、正确数或正确率，这些字段由代码确定。
7. 完成后调用 __graph_complete__，严格提交五个字段。

LearningProfileEvidence：${JSON.stringify(input.data.evidence)}`,
    }),
  };
  const updateLearningProfile: Graph = {
    id: "study_update_learning_profile",
    goal: "从用户选中的学习记录生成长期学习画像候选",
    entries: [singleNodeEntry("update_learning_profile")],
    nodes: { update_learning_profile: learningProfileNode },
    routing: {
      update_learning_profile: {
        nodeId: "update_learning_profile",
        edges: [finishEdge("update_learning_profile")],
        router: { kind: "first-match" },
      },
    },
  };

  return { generateQuestion, gradeAnswer, discussQuestion, summarizeSession, updateLearningProfile };
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

export function asLearningProfileCandidate(result: Record<string, unknown>): LearningProfileCandidate {
  const validation = validateLearningProfileResult(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as LearningProfileCandidate;
}

export function difficultyFrom(value: string): DifficultyLevel {
  const allowed = new Set<DifficultyLevel>(["S-R", "S-U", "M-U", "M-A", "C-A"]);
  if (!allowed.has(value as DifficultyLevel)) throw new Error(`Unsupported difficulty: ${value}`);
  return value as DifficultyLevel;
}
