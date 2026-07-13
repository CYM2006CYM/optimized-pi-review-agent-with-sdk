import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStudyWalkingSkeletonGraphs,
  validateDiscussionResult,
  validateGradeResult,
  validateQuestionResult,
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
    expect(validateGradeResult({}).isValid).toBe(false);
    expect(validateDiscussionResult({ reply: "解释", clarified_points: [], lingering_questions: [] }).isValid).toBe(true);
    expect(validateSummaryResult({ summary_markdown: "" }).isValid).toBe(false);
  });
});
