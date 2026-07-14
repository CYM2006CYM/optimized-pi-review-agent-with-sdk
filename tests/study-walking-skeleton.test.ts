import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStudyWalkingSkeletonGraphs,
  validateDiscussionResult,
  validateGradeResult,
  validateQuestionResult,
  validateQuestionResultForRequest,
  validateLearningProfileResult,
  validateProfileBuildFragment,
  validateProfileRevisionPatch,
  validateProfileRevisionPlan,
  validateProfileRevisionQuality,
  validateSummaryResult,
} from "../src/graphs/study-walking-skeleton.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

describe("学习 walking skeleton 图", () => {
  let dataRoot: string;
  let profiles: ProfileFamilyRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-study-graph-"));
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
    });
    await profiles.seedDemoProfile();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("包含学习、画像和 Profile 构建所需的真实 Agent Run 节点", () => {
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    expect(graphs.generateQuestion.nodes.prepare_question_context?.kind).toBe("code");
    expect(graphs.generateQuestion.nodes.generate_question?.kind).toBe("code");
    expect(graphs.gradeAnswer.nodes.grade_answer?.kind).toBe("code");
    expect(graphs.discussQuestion.nodes.discuss_question?.kind).toBe("code");
    expect(graphs.summarizeSession.nodes.summarize_session?.kind).toBe("code");
    expect(graphs.updateLearningProfile.nodes.update_learning_profile?.kind).toBe("code");
    expect(graphs.buildProfileFragment.nodes.build_profile_fragment?.kind).toBe("code");
    expect(graphs.planProfileRevision.nodes.plan_profile_revision?.kind).toBe("code");
    expect(graphs.reviseProfileDraft.nodes.revise_profile_draft?.kind).toBe("code");
    expect(graphs.reviewProfileDraft.nodes.review_profile_draft?.kind).toBe("code");
    expect(Object.keys(graphs.generateQuestion.routing)).toEqual(["prepare_question_context", "generate_question"]);
  });

  it("代码节点直接读取 active Profile，不调用 NodeContext.callTool", async () => {
    const graph = createStudyWalkingSkeletonGraphs(profiles).generateQuestion;
    const node = graph.nodes.prepare_question_context;
    if (!node || node.kind !== "code") throw new Error("prepare node missing");
    const completion = await node.execute(
      { id: "test", globalGoal: "test", background: {}, frames: [], mechanisms: [], scratch: {} },
      {
        data: { subjectId: "demo-review", scopeId: "chapter:1", difficulty: "S-U", questionType: "short_answer" },
        source: { kind: "entry", entryId: "main" },
      },
      {
        signal: new AbortController().signal,
        runAgent: async () => { throw new Error("not used"); },
        callTool: async () => { throw new Error("callTool must not be used"); },
      },
    );
    expect(completion.status).toBe("ok");
    expect(completion.result.material).toContain("主动回忆");
  });

  it("代码节点按卡片或小节收窄 Agent 可见资料", async () => {
    const graph = createStudyWalkingSkeletonGraphs(profiles).generateQuestion;
    const node = graph.nodes.prepare_question_context;
    if (!node || node.kind !== "code") throw new Error("prepare node missing");
    const execute = (data: Record<string, unknown>) => node.execute(
      { id: "test", globalGoal: "test", background: {}, frames: [], mechanisms: [], scratch: {} },
      { data, source: { kind: "entry", entryId: "main" } },
      {
        signal: new AbortController().signal,
        runAgent: async () => { throw new Error("not used"); },
        callTool: async () => { throw new Error("callTool must not be used"); },
      },
    );

    const card = await execute({
      subjectId: "demo-review",
      scopeId: "chapter:1",
      targetKind: "card",
      targetId: "active_recall",
      difficulty: "S-U",
      questionType: "short_answer",
      mode: "card_practice",
    });
    expect(card.result.target).toMatchObject({ kind: "card", id: "active_recall" });
    expect(card.result.knowledgePointIds).toEqual(["active_recall"]);
    expect(card.result.material).toContain("# 主动回忆");
    expect(card.result.material).not.toContain("# 学习方法 Demo");

    const section = await execute({
      subjectId: "demo-review",
      scopeId: "chapter:1",
      targetKind: "section",
      targetId: "ch01-sec01",
      difficulty: "M-U",
      questionType: "short_answer",
      mode: "chapter_study",
    });
    expect(section.result.target).toMatchObject({ kind: "section", id: "ch01-sec01" });
    expect(section.result.knowledgePointIds).toEqual(["active_recall", "spaced_review", "interleaving"]);
    expect(section.result.material).toContain("# 记忆与练习");
    expect(section.result.material).not.toContain("# 学习方法 Demo");
  });

  it("Agent 输出门禁拒绝缺字段并接受完整结果", () => {
    expect(validateQuestionResult({}).isValid).toBe(false);
    expect(validateQuestionResult({
      question_id: "q1",
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      question_text: "什么是主动回忆？",
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "资料",
      related_knowledge_chain: [],
    }).isValid).toBe(true);
    expect(validateQuestionResultForRequest({
      question_id: "q1",
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      question_text: "什么是主动回忆？",
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "资料",
      related_knowledge_chain: [],
    }, "M-U", "short_answer")).toEqual({
      isValid: false,
      reason: "difficulty 必须与用户选择一致：M-U",
    });
    expect(validateQuestionResultForRequest({
      question_id: "q1",
      knowledge_points: ["spaced_review"],
      difficulty: "S-U",
      type: "short_answer",
      question_text: "什么是主动回忆？",
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "资料",
      related_knowledge_chain: [],
    }, "S-U", "short_answer", ["active_recall"], "active_recall")).toEqual({
      isValid: false,
      reason: "knowledge_points 超出当前学习目标",
    });
    expect(validateGradeResult({}).isValid).toBe(false);
    expect(validateDiscussionResult({ reply: "解释", clarified_points: [], lingering_questions: [] }).isValid).toBe(true);
    expect(validateSummaryResult({ summary_markdown: "" }).isValid).toBe(false);
    expect(validateSummaryResult({
      summary_markdown: "# 总结",
      observed_facts: [],
      mastery_evidence: [],
      unverified_topics: [],
      recommendations: [],
    }).isValid).toBe(true);
    expect(validateLearningProfileResult({
      profile_summary: "累计画像",
      weak_points: [],
      strengths: ["主动回忆"],
      unverified_topics: [],
      recommendations: ["继续练习"],
    }).isValid).toBe(true);
    expect(validateLearningProfileResult({
      profile_summary: "",
      weak_points: [],
      strengths: [],
      unverified_topics: [],
      recommendations: [],
    }).isValid).toBe(false);
  });

  it("Profile 构建输出门禁只接受当前批次内的完整语义片段", () => {
    const validFragment = {
      subject_overview: "介绍主动回忆及其练习方法。",
      warnings: [],
      chapters: [{
        title: "学习方法",
        source_ids: ["source-1"],
        sections: [{
          title: "主动回忆",
          markdown: "主动回忆要求学习者先尝试从记忆中提取信息，再核对资料。",
          source_ids: ["source-1"],
          knowledge_points: [{
            id: "active-recall",
            name: "主动回忆",
            aliases: [],
            tags: ["记忆"],
            definition: "不看资料，主动尝试提取已经学习的信息。",
            key_points: ["先提取，再核对"],
            common_misconceptions: ["重复阅读等同于掌握"],
            related: [],
            question_types: ["short_answer"],
            difficulty_baseline: "S-U",
            source_ids: ["source-1"],
          }],
        }],
      }],
    };

    expect(validateProfileBuildFragment(validFragment, ["source-1"]).isValid).toBe(true);
    expect(validateProfileBuildFragment({
      ...validFragment,
      chapters: [{ ...validFragment.chapters[0], source_ids: ["source-outside-batch"] }],
    }, ["source-1"]).isValid).toBe(false);
    expect(validateProfileBuildFragment({
      ...validFragment,
      chapters: [{ ...validFragment.chapters[0], sections: [] }],
    }, ["source-1"]).isValid).toBe(false);
    expect(validateProfileBuildFragment({
      ...validFragment,
      chapters: [{
        ...validFragment.chapters[0],
        sections: [{ ...validFragment.chapters[0].sections[0], knowledge_points: [] }],
      }],
    }, ["source-1"]).isValid).toBe(false);
  });

  it("Profile 修订门禁限制影响范围、补丁和质量结论", () => {
    const plan = {
      summary: "修订科目说明",
      requires_clarification: false,
      clarification_question: "",
      operations: [{ path: "subject.md", operation: "update" as const, reason: "补充说明" }],
      warnings: [],
    };
    expect(validateProfileRevisionPlan(plan, ["subject.md"]).isValid).toBe(true);
    expect(validateProfileRevisionPlan({
      ...plan,
      operations: [{ path: "profile.json", operation: "update", reason: "越权" }],
    }, ["profile.json"]).isValid).toBe(false);
    expect(validateProfileRevisionPatch({
      summary: "已修订",
      changes: [{ path: "subject.md", operation: "update", reason: "补充说明", content: "# 修订\n" }],
      unresolved: [],
    }, plan).isValid).toBe(true);
    expect(validateProfileRevisionPatch({
      summary: "越权",
      changes: [{ path: "source_map.json", operation: "update", reason: "夹带", content: "{}" }],
      unresolved: [],
    }, plan).isValid).toBe(false);
    expect(validateProfileRevisionQuality({
      report_markdown: "# 质量报告",
      blocking_issues: ["缺少卡片"],
      warnings: [],
      recommendation: "enable",
    }).isValid).toBe(false);
  });

  it("判题 Agent 被明确限制为只判 submitted_answer，不能改写成放弃", async () => {
    const node = createStudyWalkingSkeletonGraphs(profiles).gradeAnswer.nodes.grade_answer;
    if (!node || node.kind !== "code") throw new Error("grade node missing");
    let prompt = "";
    await node.execute(
      { id: "test", globalGoal: "test", background: {}, frames: [], mechanisms: [], scratch: {} },
      {
        data: { question: { question_text: "题目", correct_answer: "答案" }, userAnswer: "我不知道题目是什么" },
        source: { kind: "entry", entryId: "main" },
      },
      {
        signal: new AbortController().signal,
        runAgent: async (request) => {
          prompt = request.prompt;
          return { nodeId: "grade_answer", status: "ok", result: {} };
        },
        callTool: async () => { throw new Error("not used"); },
      },
    );
    expect(prompt).toContain("一定是 submitted_answer");
    expect(prompt).toContain("不能描述为“用户放弃”");
  });

  it("总结 Agent 只消费受控 SessionEvidence", async () => {
    const node = createStudyWalkingSkeletonGraphs(profiles).summarizeSession.nodes.summarize_session;
    if (!node || node.kind !== "code") throw new Error("summary node missing");
    let prompt = "";
    await node.execute(
      { id: "test", globalGoal: "test", background: {}, frames: [], mechanisms: [], scratch: {} },
      {
        data: {
          evidence: {
            session: { total_questions: 1, correct: 0, gave_up: 1 },
            observed_facts: ["完成 1 题"],
            mastery_evidence: [],
            unverified_topics: ["active_recall"],
            recommendations: [],
          },
          difficultyCatalog: { "S-U": { label: "简单·理解" } },
          summaryKind: "final",
        },
        source: { kind: "entry", entryId: "main" },
      },
      {
        signal: new AbortController().signal,
        runAgent: async (request) => {
          prompt = request.prompt;
          return { nodeId: "summarize_session", status: "ok", result: {} };
        },
        callTool: async () => { throw new Error("not used"); },
      },
    );
    expect(prompt).toContain('\"unverified_topics\":[\"active_recall\"]');
    expect(prompt).toContain("不能改写为薄弱点或错误知识");
    expect(prompt).not.toContain("user_answer");
    expect(prompt).not.toContain("correct_answer");
  });
});
