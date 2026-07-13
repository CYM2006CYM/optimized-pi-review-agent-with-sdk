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

  it("包含代码准备节点和三个真实 Agent Run 节点", () => {
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    expect(graphs.generateQuestion.nodes.prepare_question_context?.kind).toBe("code");
    expect(graphs.generateQuestion.nodes.generate_question?.kind).toBe("code");
    expect(graphs.gradeAnswer.nodes.grade_answer?.kind).toBe("code");
    expect(graphs.discussQuestion.nodes.discuss_question?.kind).toBe("code");
    expect(graphs.summarizeSession.nodes.summarize_session?.kind).toBe("code");
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
    expect(validateGradeResult({}).isValid).toBe(false);
    expect(validateDiscussionResult({ reply: "解释", clarified_points: [], lingering_questions: [] }).isValid).toBe(true);
    expect(validateSummaryResult({ summary_markdown: "" }).isValid).toBe(false);
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

  it("总结 Agent 只把 outcome=gave_up 视为明确放弃", async () => {
    const node = createStudyWalkingSkeletonGraphs(profiles).summarizeSession.nodes.summarize_session;
    if (!node || node.kind !== "code") throw new Error("summary node missing");
    let prompt = "";
    await node.execute(
      { id: "test", globalGoal: "test", background: {}, frames: [], mechanisms: [], scratch: {} },
      {
        data: { session: { totalQuestions: 1 }, attempts: [{ outcome: "correct" }] },
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
    expect(prompt).toContain("attempt.outcome 是业务结果的唯一事实来源");
    expect(prompt).toContain("只有 outcome=gave_up 才能写“用户主动放弃”");
  });
});
