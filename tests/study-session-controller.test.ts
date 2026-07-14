import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StudySessionController,
  type StudyControllerUi,
} from "../src/application/study-session-controller.js";
import type { Attempt, GradeResult, StudySession } from "../src/domain/types.js";
import type { IsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";
import { createStudyWalkingSkeletonGraphs } from "../src/graphs/study-walking-skeleton.js";
import { PrivateMemoryRepository } from "../src/repositories/private-memory-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

const SCOPE = "第 1 章 · 记忆与练习";
const MODE = "练习 · 直接答题";
const DIFFICULTY = "S-U · 基础理解";
const QUESTION_TYPE = "简答题";
const DIGEST = "已理解，进入功能菜单";
const END_SESSION = "结束并保存总结";

class RecordingUi implements StudyControllerUi {
  readonly notifications: Array<{ message: string; level?: string }> = [];
  readonly statuses: Array<string | undefined> = [];
  readonly selectTitles: string[] = [];
  readonly widgets = new Map<string, string[] | undefined>();

  constructor(
    readonly selections: Array<string | undefined>,
    readonly inputs: Array<string | undefined>,
  ) {}

  setWidget(key: string, content: string[] | undefined): void {
    this.widgets.set(key, content);
  }

  async input(): Promise<string | undefined> {
    return this.inputs.shift();
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    this.selectTitles.push(title);
    const selected = this.selections.shift();
    if (selected === "__FIRST__") return options[0];
    return selected;
  }

  notify(message: string, level?: "info" | "warning" | "error"): void {
    this.notifications.push({ message, level });
  }

  setStatus(_key: string, text: string | undefined): void {
    this.statuses.push(text);
  }
}

function questionResult(): Record<string, unknown> {
  return {
    question_id: "agent-question",
    knowledge_points: ["active_recall"],
    difficulty: "S-U",
    type: "short_answer",
    question_text: "什么是主动回忆？",
    correct_answer: "先不看资料，从记忆中提取内容。",
    explanation_l1: "主动提取能检验真实掌握。",
    source_basis: "active Profile",
    related_knowledge_chain: ["spaced_review"],
  };
}

function grade(isCorrect: boolean): GradeResult {
  return {
    is_correct: isCorrect,
    correct_answer: "先不看资料，从记忆中提取内容。",
    explanation_l1: "主动提取能检验真实掌握。",
    knowledge_chain_l3: ["spaced_review"],
    suggestion_next: isCorrect ? "进入下一题" : "再次作答",
    grading: isCorrect ? "核心意思正确" : "缺少主动提取",
  };
}

function graphResult(graph: Graph, result: Record<string, unknown>, status: GraphRunResult["status"] = "ok"): GraphRunResult {
  return { graphId: graph.id, status, result, steps: 1 };
}

interface HarnessOptions {
  selections?: Array<string | undefined>;
  inputs?: Array<string | undefined>;
  grades?: GradeResult[];
  summaryFailure?: boolean;
  summaryFailures?: number;
  memory?: PrivateMemoryRepository;
}

describe("StudySessionController", () => {
  let dataRoot: string;
  let profiles: ProfileFamilyRepository;
  let memory: PrivateMemoryRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-study-controller-"));
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
    });
    memory = new PrivateMemoryRepository({
      dataRoot,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function harness(options: HarnessOptions = {}) {
    const ui = new RecordingUi(
      options.selections ?? [SCOPE, MODE, DIFFICULTY, QUESTION_TYPE, DIGEST, END_SESSION],
      options.inputs ?? ["主动回忆是先不看资料进行提取。"],
    );
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    const calls: string[] = [];
    const grades = [...(options.grades ?? [grade(true)])];
    let summaryFailures = options.summaryFailures ?? 0;
    const executeGraph: IsolatedGraphExecutor = async (graph) => {
      calls.push(graph.id);
      if (graph.id === graphs.generateQuestion.id) return graphResult(graph, questionResult());
      if (graph.id === graphs.gradeAnswer.id) return graphResult(graph, { ...(grades.shift() ?? grade(true)) });
      if (graph.id === graphs.discussQuestion.id) {
        return graphResult(graph, { reply: "提示", clarified_points: [], lingering_questions: [] });
      }
      if (options.summaryFailure || summaryFailures > 0) {
        summaryFailures = Math.max(0, summaryFailures - 1);
        return graphResult(graph, { reason: "summary failed" }, "failed");
      }
      return graphResult(graph, {
        summary_markdown: "# 学习总结\n\n完成本次学习。",
        observed_facts: [],
        mastery_evidence: [],
        unverified_topics: [],
        recommendations: [],
      });
    };
    const ids = ["session-1", "question-1", "question-2"];
    const controller = new StudySessionController({
      profiles,
      memory: options.memory ?? memory,
      graphs,
      executeGraph,
      ui,
      now: () => new Date("2026-07-13T16:05:00.000Z"),
      createId: () => ids.shift() ?? "fallback-id",
    });
    return { controller, ui, calls, executeGraph, graphs };
  }

  async function createInterruptedBatchWithAttempt(sessionId = "interrupted-session") {
    const running: StudySession = {
      sessionId,
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: SCOPE,
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: SCOPE, enteredAt: "2026-07-13T15:00:00.000Z" }],
      totalQuestions: 1,
      correct: 1,
      incorrect: 0,
      createdAt: "2026-07-13T15:00:00.000Z",
      updatedAt: "2026-07-13T15:05:00.000Z",
    };
    const batch = await memory.createPendingBatch(running);
    await memory.saveAttempt("demo-review", batch.batchId, {
      question_id: `${sessionId}-question`,
      session_id: running.sessionId,
      scope_id: "chapter:1",
      scope_label: SCOPE,
      target_kind: "scope",
      target_id: "chapter:1",
      target_label: SCOPE,
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      timestamp: "2026-07-13T15:04:00.000Z",
      question_text: "什么是主动回忆？",
      user_answer: "主动提取",
      answer_history: [{
        answer: "主动提取",
        is_correct: true,
        grading: "正确",
        timestamp: "2026-07-13T15:04:00.000Z",
      }],
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "active Profile",
      outcome: "correct",
      is_correct: true,
      knowledge_chain_l3: [],
      suggestion_next: "继续",
    });
    const endedAt = "2026-07-13T15:05:30.000Z";
    await memory.interruptSession("demo-review", batch.batchId, {
      ...running,
      status: "interrupted",
      updatedAt: endedAt,
      endedAt,
    });
    return batch;
  }

  it("首次答对后保存 attempt、总结并完成会话", async () => {
    const { controller, calls } = harness();

    const result = await controller.run("demo-review");

    expect(result.status).toBe("completed");
    expect(calls).toEqual(["study_generate_question", "study_grade_answer", "study_summarize_session"]);
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.session).toMatchObject({ status: "completed", totalQuestions: 1, correct: 1, incorrect: 0 });
    expect(batch?.attempts).toHaveLength(1);
    expect(batch?.attempts[0]).toMatchObject({ outcome: "correct", target_kind: "scope" });
    expect(batch?.summaryMarkdown).toContain("学习总结");
  });

  it("答错后重答只增加一次判题并保存完整 answer_history", async () => {
    const { controller, calls } = harness({
      selections: [SCOPE, MODE, DIFFICULTY, QUESTION_TYPE, "再次作答", DIGEST, END_SESSION],
      inputs: ["错误答案", "先不看资料主动提取"],
      grades: [grade(false), grade(true)],
    });

    await expect(controller.run("demo-review")).resolves.toMatchObject({ status: "completed" });
    expect(calls.filter((id) => id === "study_grade_answer")).toHaveLength(2);
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.attempts[0]?.answer_history).toHaveLength(2);
    expect(batch?.attempts[0]?.outcome).toBe("correct");
  });

  it("明确放弃不调用判题图", async () => {
    const { controller, calls } = harness({ inputs: ["/giveup"] });

    await expect(controller.run("demo-review")).resolves.toMatchObject({ status: "completed" });
    expect(calls).toEqual(["study_generate_question", "study_summarize_session"]);
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.attempts[0]).toMatchObject({ outcome: "gave_up", is_correct: false, user_answer: "" });
  });

  it("答题输入取消时标记 interrupted，不伪造 attempt 或 summary", async () => {
    const { controller, ui } = harness({ inputs: [undefined] });

    const result = await controller.run("demo-review");

    expect(result.status).toBe("interrupted");
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.session.status).toBe("interrupted");
    expect(batch?.attempts).toEqual([]);
    expect(batch?.summaryMarkdown).toBeUndefined();
    expect(ui.notifications.at(-1)).toMatchObject({ level: "error" });
  });

  it("最终总结失败时保留已完成题目并标记 interrupted", async () => {
    const { controller } = harness({ summaryFailure: true });

    const result = await controller.run("demo-review");

    expect(result).toMatchObject({ status: "interrupted", error: expect.stringContaining("summary failed") });
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.session.status).toBe("interrupted");
    expect(batch?.attempts).toHaveLength(1);
    expect(batch?.summaryMarkdown).toBeUndefined();
  });

  it("最终总结首次未完成时在新隔离会话重试并正常保存", async () => {
    const { controller, calls } = harness({ summaryFailures: 1 });

    await expect(controller.run("demo-review")).resolves.toMatchObject({ status: "completed" });
    expect(calls.filter((id) => id === "study_summarize_session")).toHaveLength(2);
    const [batch] = await memory.listPendingBatches("demo-review");
    expect(batch?.session.status).toBe("completed");
    expect(batch?.summaryMarkdown).toContain("学习总结");
  });

  it("attempt 持久化失败时不进入题后菜单并标记 interrupted", async () => {
    class FailingMemoryRepository extends PrivateMemoryRepository {
      override async saveAttempt(): Promise<void> {
        throw new Error("disk unavailable");
      }
    }
    const failingMemory = new FailingMemoryRepository({
      dataRoot,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
    });
    const { controller, ui } = harness({ memory: failingMemory });

    const result = await controller.run("demo-review");

    expect(result).toMatchObject({ status: "interrupted", error: "disk unavailable" });
    expect(ui.selectTitles).not.toContain("题目消化");
    expect(ui.selectTitles).not.toContain("学习功能");
    const [batch] = await failingMemory.listPendingBatches("demo-review");
    expect(batch?.session.status).toBe("interrupted");
    expect(batch?.attempts).toEqual([]);
  });

  it("可以为遗留 running 会话补总结并完成", async () => {
    const running: StudySession = {
      sessionId: "legacy-session",
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: SCOPE,
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: SCOPE, enteredAt: "2026-07-13T15:00:00.000Z" }],
      totalQuestions: 1,
      correct: 1,
      incorrect: 0,
      createdAt: "2026-07-13T15:00:00.000Z",
      updatedAt: "2026-07-13T15:05:00.000Z",
    };
    const batch = await memory.createPendingBatch(running);
    const attempt: Attempt = {
      question_id: "legacy-question",
      session_id: running.sessionId,
      scope_id: "chapter:1",
      scope_label: SCOPE,
      target_kind: "scope",
      target_id: "chapter:1",
      target_label: SCOPE,
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      timestamp: "2026-07-13T15:04:00.000Z",
      question_text: "什么是主动回忆？",
      user_answer: "主动提取",
      answer_history: [{
        answer: "主动提取",
        is_correct: true,
        grading: "正确",
        timestamp: "2026-07-13T15:04:00.000Z",
      }],
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "active Profile",
      outcome: "correct",
      is_correct: true,
      knowledge_chain_l3: [],
      suggestion_next: "继续",
    };
    await memory.saveAttempt("demo-review", batch.batchId, attempt);
    const { controller, ui, calls } = harness({
      selections: ["__FIRST__", "生成总结并结束"],
      inputs: [],
    });

    const result = await controller.recoverRunningSession();

    expect(result).toMatchObject({ status: "completed", batchId: batch.batchId });
    expect(calls).toEqual(["study_summarize_session"]);
    const loaded = await memory.loadPendingBatch("demo-review", batch.batchId);
    expect(loaded.session.status).toBe("completed");
    expect(loaded.summaryMarkdown).toContain("学习总结");
    expect(ui.notifications.at(-1)?.message).toContain("已补全");
  });

  it("零题遗留会话可以直接标记中断且不需要模型", async () => {
    const running: StudySession = {
      sessionId: "legacy-session",
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: SCOPE,
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: SCOPE, enteredAt: "2026-07-13T15:00:00.000Z" }],
      totalQuestions: 0,
      correct: 0,
      incorrect: 0,
      createdAt: "2026-07-13T15:00:00.000Z",
      updatedAt: "2026-07-13T15:00:00.000Z",
    };
    const batch = await memory.createPendingBatch(running);
    const executeGraph = vi.fn<IsolatedGraphExecutor>();
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    const ui = new RecordingUi(["__FIRST__", "标记为中断"], []);
    const controller = new StudySessionController({ profiles, memory, graphs, executeGraph, ui });

    await expect(controller.recoverRunningSession()).resolves.toMatchObject({ status: "interrupted" });
    expect(executeGraph).not.toHaveBeenCalled();
    expect((await memory.loadPendingBatch("demo-review", batch.batchId)).session.status).toBe("interrupted");
  });

  it("可以为有 attempt 且无 summary 的 interrupted 会话补总结", async () => {
    const batch = await createInterruptedBatchWithAttempt();
    const { controller, ui, calls } = harness({
      selections: ["__FIRST__", "生成总结并结束"],
      inputs: [],
    });

    await expect(controller.countRunningSessions()).resolves.toBe(0);
    await expect(controller.countRecoverableSessions()).resolves.toBe(1);
    await expect(controller.recoverRunningSession()).resolves.toMatchObject({
      status: "completed",
      batchId: batch.batchId,
    });

    expect(calls).toEqual(["study_summarize_session"]);
    expect(ui.selectTitles).toContain("如何处理该会话？");
    const loaded = await memory.loadPendingBatch("demo-review", batch.batchId);
    expect(loaded.session.status).toBe("completed");
    expect(loaded.summaryMarkdown).toContain("学习总结");
  });

  it("零题 interrupted 会话不进入补总结候选", async () => {
    const running: StudySession = {
      sessionId: "empty-interrupted-session",
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: SCOPE,
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: SCOPE, enteredAt: "2026-07-13T15:00:00.000Z" }],
      totalQuestions: 0,
      correct: 0,
      incorrect: 0,
      createdAt: "2026-07-13T15:00:00.000Z",
      updatedAt: "2026-07-13T15:00:00.000Z",
    };
    const batch = await memory.createPendingBatch(running);
    await memory.interruptSession("demo-review", batch.batchId, { ...running, status: "interrupted" });
    const { controller, calls, ui } = harness({ selections: [], inputs: [] });

    await expect(controller.countRecoverableSessions()).resolves.toBe(0);
    await expect(controller.recoverRunningSession()).resolves.toEqual({ status: "none" });
    expect(calls).toEqual([]);
    expect(ui.notifications.at(-1)?.message).toContain("没有需要处理");
  });

  it("interrupted 会话补总结失败时保持 interrupted 供下次重试", async () => {
    const batch = await createInterruptedBatchWithAttempt("retry-interrupted-session");
    const { controller, ui } = harness({
      selections: ["__FIRST__", "生成总结并结束"],
      inputs: [],
      summaryFailure: true,
    });

    await expect(controller.recoverRunningSession()).resolves.toMatchObject({
      status: "failed",
      batchId: batch.batchId,
    });
    expect((await memory.loadPendingBatch("demo-review", batch.batchId)).session.status).toBe("interrupted");
    expect(ui.notifications.at(-1)?.message).toContain("保持 interrupted");
  });

  it("遗留会话补总结失败时保持 running 供下次重试", async () => {
    const running: StudySession = {
      sessionId: "retry-session",
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: SCOPE,
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: SCOPE, enteredAt: "2026-07-13T15:00:00.000Z" }],
      totalQuestions: 1,
      correct: 0,
      incorrect: 1,
      createdAt: "2026-07-13T15:00:00.000Z",
      updatedAt: "2026-07-13T15:05:00.000Z",
    };
    const batch = await memory.createPendingBatch(running);
    await memory.saveAttempt("demo-review", batch.batchId, {
      question_id: "retry-question",
      session_id: running.sessionId,
      scope_id: "chapter:1",
      scope_label: SCOPE,
      target_kind: "scope",
      target_id: "chapter:1",
      target_label: SCOPE,
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      timestamp: "2026-07-13T15:04:00.000Z",
      question_text: "什么是主动回忆？",
      user_answer: "",
      answer_history: [],
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "active Profile",
      outcome: "gave_up",
      is_correct: false,
      knowledge_chain_l3: [],
      suggestion_next: "重试",
    });
    const { controller, ui } = harness({
      selections: ["__FIRST__", "生成总结并结束"],
      inputs: [],
      summaryFailure: true,
    });

    const result = await controller.recoverRunningSession();

    expect(result).toMatchObject({ status: "failed", batchId: batch.batchId });
    expect((await memory.loadPendingBatch("demo-review", batch.batchId)).session.status).toBe("running");
    expect(ui.notifications.at(-1)).toMatchObject({ level: "error" });
    expect(ui.notifications.at(-1)?.message).toContain("可稍后重试");
  });
});
