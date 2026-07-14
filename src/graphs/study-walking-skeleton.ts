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
import type { ProfileBuildFragment } from "../domain/profile-build.js";
import type {
  ProfileRevisionPatch,
  ProfileRevisionPlan,
  ProfileRevisionQualityReview,
} from "../domain/profile-revision.js";
import {
  assertValidRevisionPatch,
  assertValidRevisionPlan,
} from "../domain/profile-revision.js";
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

const profileBuildPointSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    definition: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    common_misconceptions: { type: "array", items: { type: "string" } },
    related: { type: "array", items: { type: "string" } },
    question_types: { type: "array", items: { enum: ["choice", "judgment", "short_answer"] } },
    difficulty_baseline: { enum: ["S-R", "S-U", "M-U", "M-A", "C-A"] },
    source_ids: { type: "array", items: { type: "string" } },
  },
  required: ["id", "name", "aliases", "tags", "definition", "key_points", "common_misconceptions", "related", "question_types", "difficulty_baseline", "source_ids"],
  additionalProperties: false,
};

const profileBuildFragmentSchema = {
  type: "object",
  properties: {
    subject_overview: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          source_ids: { type: "array", items: { type: "string" } },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                markdown: { type: "string" },
                source_ids: { type: "array", items: { type: "string" } },
                knowledge_points: { type: "array", items: profileBuildPointSchema },
              },
              required: ["title", "markdown", "source_ids", "knowledge_points"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "source_ids", "sections"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["subject_overview", "chapters", "warnings"],
  additionalProperties: false,
};

const profileRevisionPlanSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    requires_clarification: { type: "boolean" },
    clarification_question: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          operation: { enum: ["create", "update", "delete"] },
          reason: { type: "string" },
        },
        required: ["path", "operation", "reason"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "requires_clarification", "clarification_question", "operations", "warnings"],
  additionalProperties: false,
};

const profileRevisionPatchSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          operation: { enum: ["create", "update", "delete"] },
          content: { type: "string" },
          reason: { type: "string" },
        },
        required: ["path", "operation", "reason"],
        additionalProperties: false,
      },
    },
    unresolved: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "changes", "unresolved"],
  additionalProperties: false,
};

const profileRevisionQualitySchema = {
  type: "object",
  properties: {
    report_markdown: { type: "string" },
    blocking_issues: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    recommendation: { enum: ["enable", "revise"] },
  },
  required: ["report_markdown", "blocking_issues", "warnings", "recommendation"],
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

export function validateProfileBuildFragment(
  result: Record<string, unknown>,
  allowedSourceIds: readonly string[] = [],
): CompletionValidationResult {
  if (!validString(result.subject_overview)) return { isValid: false, reason: "subject_overview 不能为空" };
  if (!Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string")) {
    return { isValid: false, reason: "warnings 必须是字符串数组" };
  }
  if (!Array.isArray(result.chapters) || result.chapters.length === 0) {
    return { isValid: false, reason: "chapters 必须是非空数组" };
  }
  const allowed = new Set(allowedSourceIds);
  const validSources = (value: unknown): value is string[] => Array.isArray(value)
    && value.length > 0
    && value.every((item) => typeof item === "string" && (allowed.size === 0 || allowed.has(item)));
  for (const chapter of result.chapters as Array<Record<string, unknown>>) {
    if (!validString(chapter.title) || !validSources(chapter.source_ids)) {
      return { isValid: false, reason: "chapter title/source_ids 无效或超出当前批次" };
    }
    if (!Array.isArray(chapter.sections) || chapter.sections.length === 0) {
      return { isValid: false, reason: "每章至少需要一个 section" };
    }
    for (const section of chapter.sections as Array<Record<string, unknown>>) {
      if (!validString(section.title) || !validString(section.markdown) || !validSources(section.source_ids)) {
        return { isValid: false, reason: "section 字段无效或 source_ids 超出当前批次" };
      }
      if (!Array.isArray(section.knowledge_points) || section.knowledge_points.length === 0) {
        return { isValid: false, reason: "每个 section 至少需要一个 knowledge point" };
      }
      for (const point of section.knowledge_points as Array<Record<string, unknown>>) {
        for (const key of ["id", "name", "definition"]) {
          if (!validString(point[key])) return { isValid: false, reason: `knowledge point ${key} 不能为空` };
        }
        for (const key of ["aliases", "tags", "key_points", "common_misconceptions", "related", "question_types"]) {
          if (!Array.isArray(point[key]) || (point[key] as unknown[]).some((item) => typeof item !== "string")) {
            return { isValid: false, reason: `knowledge point ${key} 必须是字符串数组` };
          }
        }
        if (!validSources(point.source_ids)) return { isValid: false, reason: "knowledge point source_ids 超出当前批次" };
        if (!(new Set(["S-R", "S-U", "M-U", "M-A", "C-A"])).has(String(point.difficulty_baseline))) {
          return { isValid: false, reason: "knowledge point difficulty_baseline 无效" };
        }
      }
    }
  }
  return { isValid: true };
}

export function validateProfileRevisionPlan(
  result: Record<string, unknown>,
  existingPaths: readonly string[],
): CompletionValidationResult {
  try {
    assertValidRevisionPlan(result as unknown as ProfileRevisionPlan, existingPaths);
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateProfileRevisionPatch(
  result: Record<string, unknown>,
  plan: ProfileRevisionPlan,
): CompletionValidationResult {
  try {
    assertValidRevisionPatch(result as unknown as ProfileRevisionPatch, plan);
    return { isValid: true };
  } catch (error) {
    return { isValid: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateProfileRevisionQuality(result: Record<string, unknown>): CompletionValidationResult {
  if (!validString(result.report_markdown)) return { isValid: false, reason: "report_markdown 不能为空" };
  for (const key of ["blocking_issues", "warnings"]) {
    if (!Array.isArray(result[key]) || (result[key] as unknown[]).some((item) => typeof item !== "string" || item.trim() === "")) {
      return { isValid: false, reason: `${key} 必须是非空字符串数组` };
    }
  }
  if (result.recommendation !== "enable" && result.recommendation !== "revise") {
    return { isValid: false, reason: "recommendation 必须是 enable 或 revise" };
  }
  if ((result.blocking_issues as unknown[]).length > 0 && result.recommendation !== "revise") {
    return { isValid: false, reason: "存在 blocking_issues 时 recommendation 必须为 revise" };
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
  buildProfileFragment: Graph;
  planProfileRevision: Graph;
  reviseProfileDraft: Graph;
  reviewProfileDraft: Graph;
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
      prompt: (input) => {
        const retryReminder = Number(input.data.completionAttempt ?? 1) > 1
          ? "这是一次全新隔离会话中的总结重试。上一次没有形成节点结果，本次必须调用 __graph_complete__ 提交结构化总结。\n\n"
          : "";
        return `${retryReminder}根据代码生成的 SessionEvidence 生成中文 Markdown 学习情况总结。必须包含：学习范围、可观察事实、掌握证据、未获得掌握证据的内容、下一步建议。\n\n证据规则：\n1. 只能使用 evidence 中的字段，不得补写原始答案、心理状态、习惯或长期能力。\n2. mastery_evidence 才能支持掌握结论；clarified_points 只表示讨论涉及的内容。\n3. unverified_topics 只表示没有获得掌握证据，不能改写为薄弱点或错误知识。\n4. 建议只能使用给定的有效难度目录，不得发明等级。\n5. 输出数组必须分别对应可观察事实、掌握证据、未验证主题和建议。\n6. 完成后调用 __graph_complete__。\n\n总结类型：${String(input.data.summaryKind ?? "final")}\n有效难度目录：${JSON.stringify(input.data.difficultyCatalog)}\nSessionEvidence：${JSON.stringify(input.data.evidence)}`;
      },
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

  const profileBuildNode: Node = {
    kind: "code",
    id: "build_profile_fragment",
    subGoal: "从代码提供的 Markdown/txt 批次提取 canonical Profile 语义单元",
    tools: [],
    execute(instance, input, ctx) {
      const allowedSourceIds = Array.isArray(input.data.allowedSourceIds)
        ? input.data.allowedSourceIds.filter((item): item is string => typeof item === "string")
        : [];
      return createAgentExecute({
        outputSchema: profileBuildFragmentSchema,
        validateCompletion: (result) => validateProfileBuildFragment(result, allowedSourceIds),
        prompt: (nextInput) => `你正在从一批用户提供的 Markdown/txt 构建 canonical 学习资料包语义片段。

要求：
1. 只能使用 sources 中的内容，不得自行读取文件、调用工具或引入资料外事实。
2. chapters/sections 按资料本身的主题组织；每个 section 至少提取一个可学习知识点。
3. knowledge point id 使用简短稳定的英文/数字 kebab-case；name 使用资料中的可读名称。
4. markdown 是该小节的自包含学习正文，不包含 frontmatter、来源路径、出题提示或虚构内容。
5. source_ids 只能使用 allowedSourceIds，并准确标记实际依据。
6. question_types 只使用 choice、judgment、short_answer；difficulty_baseline 只使用五档固定等级。
7. 不确定或资料缺失写入 warnings，不要补造。
8. 完成后调用 __graph_complete__，严格提交 schema。

科目：${String(nextInput.data.subjectName)}
批次：${String(nextInput.data.batchIndex)} / ${String(nextInput.data.batchCount)}
allowedSourceIds：${JSON.stringify(allowedSourceIds)}
sources：${JSON.stringify(nextInput.data.sources)}`,
      })(instance, input, ctx);
    },
  };
  const buildProfileFragment: Graph = {
    id: "study_build_profile_fragment",
    goal: "从受控源文件批次提取 canonical Profile 语义片段",
    entries: [singleNodeEntry("build_profile_fragment")],
    nodes: { build_profile_fragment: profileBuildNode },
    routing: {
      build_profile_fragment: {
        nodeId: "build_profile_fragment",
        edges: [finishEdge("build_profile_fragment")],
        router: { kind: "first-match" },
      },
    },
  };

  const planProfileRevisionNode: Node = {
    kind: "code",
    id: "plan_profile_revision",
    subGoal: "根据用户反馈确定 canonical draft 的最小受影响文件集合",
    tools: [],
    execute(instance, input, ctx) {
      const existingPaths = Array.isArray(input.data.existingPaths)
        ? input.data.existingPaths.filter((item): item is string => typeof item === "string")
        : [];
      return createAgentExecute({
        outputSchema: profileRevisionPlanSchema,
        validateCompletion: (result) => validateProfileRevisionPlan(result, existingPaths),
        prompt: (nextInput) => `为一个 canonical 学习资料包 draft 制定最小修订计划。

规则：
1. 只根据用户反馈和代码提供的 catalog/coreFiles 规划，不读取文件或调用工具。
2. 只修改确实受影响的文件；关联的 index、卡片、章节、考点或 source_map 必须同步列入。
3. 不得修改 profile.json、quality_report.md、_user、active 或 archived。
4. update/delete 只能选择 existingPaths；create 只能使用 cards/、chapters/、exam_points/ 下安全的 .md/.json 路径。
5. 反馈含糊或缺少关键内容时，requires_clarification=true、给出一个具体问题并保持 operations 为空。
6. 资料没有证据支持的内容写入 warnings，不要计划虚构内容。
7. operations 最多 12 项；完成后调用 __graph_complete__。

用户反馈：${String(nextInput.data.feedback)}
Profile：${JSON.stringify(nextInput.data.profile)}
existingPaths：${JSON.stringify(existingPaths)}
catalog：${JSON.stringify(nextInput.data.catalog)}
coreFiles：${JSON.stringify(nextInput.data.coreFiles)}`,
      })(instance, input, ctx);
    },
  };
  const planProfileRevision: Graph = {
    id: "study_plan_profile_revision",
    goal: "确定资料包修订的最小影响范围",
    entries: [singleNodeEntry("plan_profile_revision")],
    nodes: { plan_profile_revision: planProfileRevisionNode },
    routing: {
      plan_profile_revision: {
        nodeId: "plan_profile_revision",
        edges: [finishEdge("plan_profile_revision")],
        router: { kind: "first-match" },
      },
    },
  };

  const reviseProfileDraftNode: Node = {
    kind: "code",
    id: "revise_profile_draft",
    subGoal: "在计划白名单内生成 canonical draft 文件补丁",
    tools: [],
    execute(instance, input, ctx) {
      const plan = input.data.plan as ProfileRevisionPlan;
      return createAgentExecute({
        outputSchema: profileRevisionPatchSchema,
        validateCompletion: (result) => validateProfileRevisionPatch(result, plan),
        prompt: (nextInput) => `根据已批准的修订计划生成完整文件替换内容。

规则：
1. 只能提交 plan 中列出的 path 和 operation，不得扩大影响范围。
2. update/create 必须给出完整文件 content；delete 不得给出内容。
3. 保留资料中未被反馈否定的事实，不引入 currentFiles 或用户反馈以外的知识。
4. 修改知识点时同步维护计划内的 index、卡片、章节、考点和 source_map。
5. JSON 必须是合法完整 JSON；Markdown 必须保持 canonical frontmatter 和正文结构。
6. 资料不足时写入 unresolved；不要猜测。完成后调用 __graph_complete__。

用户反馈：${String(nextInput.data.feedback)}
Profile：${JSON.stringify(nextInput.data.profile)}
plan：${JSON.stringify(plan)}
currentFiles（新文件的 content 为 null）：${JSON.stringify(nextInput.data.currentFiles)}`,
      })(instance, input, ctx);
    },
  };
  const reviseProfileDraft: Graph = {
    id: "study_revise_profile_draft",
    goal: "在受控影响范围内修订 canonical draft",
    entries: [singleNodeEntry("revise_profile_draft")],
    nodes: { revise_profile_draft: reviseProfileDraftNode },
    routing: {
      revise_profile_draft: {
        nodeId: "revise_profile_draft",
        edges: [finishEdge("revise_profile_draft")],
        router: { kind: "first-match" },
      },
    },
  };

  const reviewProfileDraftNode: Node = {
    kind: "code",
    id: "review_profile_draft",
    subGoal: "独立审查修订后的 draft 并生成质量报告",
    tools: [],
    execute: createAgentExecute({
      outputSchema: profileRevisionQualitySchema,
      validateCompletion: validateProfileRevisionQuality,
      prompt: (input) => `独立审查刚完成修订的 canonical Profile draft。

规则：
1. 代码给出的 structureInspection.blockingIssues 必须原样计入 blocking_issues，不得降低级别。
2. 检查用户反馈是否在 changedFiles 中得到满足，关联文件是否语义一致。
3. 不使用 snapshot 以外的事实，不声称检查了未提供的文件正文。
4. report_markdown 必须包含整体评估、结构指标、严重问题、待改进项、修订摘要和明确启用建议。
5. blocking_issues 非空时 recommendation 必须为 revise；无阻塞项时可以建议 enable。
6. 完成后调用 __graph_complete__。

用户反馈：${String(input.data.feedback)}
修订计划：${JSON.stringify(input.data.plan)}
补丁摘要：${JSON.stringify(input.data.patchSummary)}
structureInspection：${JSON.stringify(input.data.structureInspection)}
coreFiles：${JSON.stringify(input.data.coreFiles)}
changedFiles：${JSON.stringify(input.data.changedFiles)}`,
    }),
  };
  const reviewProfileDraft: Graph = {
    id: "study_review_profile_draft",
    goal: "形成修订 draft 的独立质量结论",
    entries: [singleNodeEntry("review_profile_draft")],
    nodes: { review_profile_draft: reviewProfileDraftNode },
    routing: {
      review_profile_draft: {
        nodeId: "review_profile_draft",
        edges: [finishEdge("review_profile_draft")],
        router: { kind: "first-match" },
      },
    },
  };

  return {
    generateQuestion,
    gradeAnswer,
    discussQuestion,
    summarizeSession,
    updateLearningProfile,
    buildProfileFragment,
    planProfileRevision,
    reviseProfileDraft,
    reviewProfileDraft,
  };
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

export function asProfileBuildFragment(result: Record<string, unknown>, allowedSourceIds: readonly string[]): ProfileBuildFragment {
  const validation = validateProfileBuildFragment(result, allowedSourceIds);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileBuildFragment;
}

export function asProfileRevisionPlan(result: Record<string, unknown>, existingPaths: readonly string[]): ProfileRevisionPlan {
  const validation = validateProfileRevisionPlan(result, existingPaths);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionPlan;
}

export function asProfileRevisionPatch(result: Record<string, unknown>, plan: ProfileRevisionPlan): ProfileRevisionPatch {
  const validation = validateProfileRevisionPatch(result, plan);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionPatch;
}

export function asProfileRevisionQuality(result: Record<string, unknown>): ProfileRevisionQualityReview {
  const validation = validateProfileRevisionQuality(result);
  if (!validation.isValid) throw new Error(validation.reason);
  return result as unknown as ProfileRevisionQualityReview;
}

export function difficultyFrom(value: string): DifficultyLevel {
  const allowed = new Set<DifficultyLevel>(["S-R", "S-U", "M-U", "M-A", "C-A"]);
  if (!allowed.has(value as DifficultyLevel)) throw new Error(`Unsupported difficulty: ${value}`);
  return value as DifficultyLevel;
}
