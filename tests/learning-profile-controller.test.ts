import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { GraphRunResult } from "pi-loop-graph-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LearningProfileController,
  type LearningProfileUpdateResult,
} from "../src/application/learning-profile-controller.js";
import type { StudyControllerUi } from "../src/application/study-session-controller.js";
import type { Attempt, StudySession } from "../src/domain/types.js";
import type { IsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";
import { createStudyWalkingSkeletonGraphs } from "../src/graphs/study-walking-skeleton.js";
import { PrivateMemoryRepository } from "../src/repositories/private-memory-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

class ProfileUi implements StudyControllerUi {
  readonly notifications: Array<{ message: string; level?: string }> = [];
  readonly statuses: Array<string | undefined> = [];

  constructor(readonly selections: Array<string | undefined>) {}

  setWidget(): void {}
  async input(): Promise<string | undefined> { return undefined; }
  async select(_title: string, options: string[]): Promise<string | undefined> {
    const next = this.selections.shift();
    return next === "__FIRST__" ? options[0] : next;
  }
  notify(message: string, level?: "info" | "warning" | "error"): void {
    this.notifications.push({ message, level });
  }
  setStatus(_key: string, text: string | undefined): void { this.statuses.push(text); }
}

describe("LearningProfileController", () => {
  let dataRoot: string;
  let profiles: ProfileFamilyRepository;
  let memory: PrivateMemoryRepository;
  let batchId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-learning-profile-controller-"));
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
    });
    await profiles.seedDemoProfile();
    memory = new PrivateMemoryRepository({
      dataRoot,
      now: () => new Date("2026-07-14T08:00:00.000Z"),
    });
    const session: StudySession = {
      sessionId: "session-1",
      subjectId: "demo-review",
      status: "running",
      mode: "practice",
      scope: "第 1 章",
      scopeHistory: [{ scopeId: "chapter:1", scopeLabel: "第 1 章", enteredAt: "2026-07-14T07:00:00.000Z" }],
      totalQuestions: 1,
      correct: 1,
      incorrect: 0,
      createdAt: "2026-07-14T07:00:00.000Z",
      updatedAt: "2026-07-14T07:10:00.000Z",
    };
    const batch = await memory.createPendingBatch(session);
    batchId = batch.batchId;
    const attempt: Attempt = {
      question_id: "question-1",
      session_id: session.sessionId,
      scope_id: "chapter:1",
      scope_label: "第 1 章",
      target_kind: "scope",
      target_id: "chapter:1",
      target_label: "第 1 章",
      knowledge_points: ["active_recall"],
      difficulty: "S-U",
      type: "short_answer",
      timestamp: "2026-07-14T07:05:00.000Z",
      question_text: "什么是主动回忆？",
      user_answer: "主动提取",
      answer_history: [{ answer: "主动提取", is_correct: true, grading: "正确", timestamp: "2026-07-14T07:05:00.000Z" }],
      correct_answer: "主动提取",
      explanation_l1: "解释",
      source_basis: "active Profile",
      outcome: "correct",
      is_correct: true,
      knowledge_chain_l3: [],
      suggestion_next: "继续",
    };
    await memory.saveAttempt("demo-review", batchId, attempt);
    await memory.completeSession("demo-review", batchId, {
      ...session,
      status: "completed",
      endedAt: "2026-07-14T07:10:00.000Z",
    }, "# 总结\n\n获得主动回忆掌握证据。\n");
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function controller(options: { selections: Array<string | undefined>; graphStatus?: GraphRunResult["status"] }) {
    const ui = new ProfileUi(options.selections);
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    const executeGraph: IsolatedGraphExecutor = async (graph) => ({
      graphId: graph.id,
      status: options.graphStatus ?? "ok",
      steps: 1,
      result: options.graphStatus === "failed"
        ? { reason: "profile graph failed" }
        : {
            profile_summary: "已获得主动回忆的掌握证据。",
            weak_points: [],
            strengths: ["主动回忆"],
            unverified_topics: [],
            recommendations: ["继续练习主动回忆"],
          },
    });
    return {
      ui,
      controller: new LearningProfileController({
        profiles,
        memory,
        graphs,
        executeGraph,
        ui,
        now: () => new Date("2026-07-14T09:00:00.000Z"),
      }),
    };
  }

  it("用户确认后写入画像并归档已消费记录", async () => {
    const { controller: subject, ui } = controller({
      selections: ["__FIRST__", "确认写入画像并归档记录"],
    });

    const result = await subject.run("demo-review");

    expect(result).toMatchObject<Partial<LearningProfileUpdateResult>>({ status: "completed" });
    expect(await memory.listPendingBatches("demo-review")).toEqual([]);
    expect(await memory.loadLearningProfile("demo-review")).toMatchObject({
      total_questions: 1,
      total_correct: 1,
      accuracy: 1,
      strengths: ["主动回忆"],
      recent_sessions: ["session-1"],
    });
    expect(ui.notifications.some((item) => item.message.includes("学习画像候选"))).toBe(true);
    expect(ui.notifications.at(-1)?.message).toContain("归档 1 个");
  });

  it("用户取消确认时不写画像也不归档", async () => {
    const { controller: subject } = controller({ selections: ["__FIRST__", "取消"] });

    await expect(subject.run("demo-review")).resolves.toEqual({ status: "cancelled" });
    expect(await memory.loadLearningProfile("demo-review")).toBeNull();
    expect((await memory.listPendingBatches("demo-review")).map((batch) => batch.batchId)).toEqual([batchId]);
  });

  it("Agent 图失败时原画像和 pending 记录保持不变", async () => {
    const { controller: subject, ui } = controller({ selections: ["__FIRST__"], graphStatus: "failed" });

    await expect(subject.run("demo-review")).resolves.toMatchObject({ status: "failed" });
    expect(await memory.loadLearningProfile("demo-review")).toBeNull();
    expect((await memory.listPendingBatches("demo-review")).map((batch) => batch.batchId)).toEqual([batchId]);
    expect(ui.notifications.at(-1)).toMatchObject({ level: "error" });
  });

  it("没有未消费记录时不调用 Agent", async () => {
    const { controller: first } = controller({ selections: ["__FIRST__", "确认写入画像并归档记录"] });
    await first.run("demo-review");
    const { controller: second, ui } = controller({ selections: [] });

    await expect(second.run("demo-review")).resolves.toEqual({ status: "none" });
    expect(ui.notifications.at(-1)?.message).toContain("没有可用于更新");
  });
});
