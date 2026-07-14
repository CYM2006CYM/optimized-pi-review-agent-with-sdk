import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Attempt, LearningProfile, StudySession } from "../src/domain/types.js";
import { PrivateMemoryRepository } from "../src/repositories/private-memory-repository.js";

const runningSession: StudySession = {
  sessionId: "session-1",
  subjectId: "demo-review",
  status: "running",
  mode: "practice",
  scope: "第 1 章",
  scopeHistory: [{
    scopeId: "chapter:1",
    scopeLabel: "第 1 章",
    enteredAt: "2026-07-13T08:00:00.000Z",
  }],
  totalQuestions: 0,
  correct: 0,
  incorrect: 0,
  createdAt: "2026-07-13T08:00:00.000Z",
  updatedAt: "2026-07-13T08:00:00.000Z",
};

const attempt: Attempt = {
  question_id: "q-1",
  session_id: "session-1",
  scope_id: "chapter:1",
  scope_label: "第 1 章",
  target_kind: "scope",
  target_id: "chapter:1",
  target_label: "第 1 章",
  knowledge_points: ["active-recall"],
  difficulty: "S-U",
  type: "short_answer",
  timestamp: "2026-07-13T08:05:00.000Z",
  question_text: "什么是主动回忆？",
  user_answer: "不看答案主动提取",
  correct_answer: "主动从记忆中提取信息",
  explanation_l1: "通过提取强化记忆",
  source_basis: "cards/active_recall.md",
  outcome: "correct",
  is_correct: true,
  knowledge_chain_l3: ["提取练习", "反馈"],
  suggestion_next: "继续",
};

describe("PrivateMemoryRepository", () => {
  let dataRoot: string;
  let repository: PrivateMemoryRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-study-memory-"));
    repository = new PrivateMemoryRepository({
      dataRoot,
      now: () => new Date("2026-07-13T08:09:10.000Z"),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("逐题写入并在正常结束时强制保存总结", async () => {
    const batch = await repository.createPendingBatch(runningSession);
    await repository.saveAttempt("demo-review", batch.batchId, attempt);
    const completed: StudySession = {
      ...runningSession,
      status: "completed",
      totalQuestions: 1,
      correct: 1,
      updatedAt: "2026-07-13T08:10:00.000Z",
      endedAt: "2026-07-13T08:10:00.000Z",
    };

    await expect(repository.completeSession("demo-review", batch.batchId, completed, "  ")).rejects.toThrow(
      "requires a non-empty learning summary",
    );
    await repository.completeSession("demo-review", batch.batchId, completed, "# 学习总结\n\n掌握主动回忆。\n");

    const loaded = await repository.loadPendingBatch("demo-review", batch.batchId);
    expect(loaded.attempts).toEqual([attempt]);
    expect(loaded.session.status).toBe("completed");
    expect(loaded.summaryMarkdown).toContain("学习总结");
  });

  it("异常中断保留已写入题目且不伪造总结", async () => {
    const batch = await repository.createPendingBatch(runningSession);
    await repository.saveAttempt("demo-review", batch.batchId, attempt);
    await repository.interruptSession("demo-review", batch.batchId, {
      ...runningSession,
      status: "interrupted",
      totalQuestions: 1,
      correct: 1,
      updatedAt: "2026-07-13T08:07:00.000Z",
      endedAt: "2026-07-13T08:07:00.000Z",
    });

    const loaded = await repository.loadPendingBatch("demo-review", batch.batchId);
    expect(loaded.session.status).toBe("interrupted");
    expect(loaded.attempts).toHaveLength(1);
    expect(loaded.summaryMarkdown).toBeUndefined();
  });

  it("每题完成后可以在会话仍 running 时同步进度", async () => {
    const batch = await repository.createPendingBatch(runningSession);
    await repository.saveAttempt("demo-review", batch.batchId, attempt);
    await repository.saveRunningSession("demo-review", batch.batchId, {
      ...runningSession,
      totalQuestions: 1,
      correct: 1,
      updatedAt: "2026-07-13T08:06:00.000Z",
    });

    const loaded = await repository.loadPendingBatch("demo-review", batch.batchId);
    expect(loaded.session.status).toBe("running");
    expect(loaded.session.totalQuestions).toBe(1);
    expect(loaded.session.correct).toBe(1);
    expect(loaded.attempts).toEqual([attempt]);
  });

  it("画像成功写入后才把选中的 pending 批次归档", async () => {
    const batch = await repository.createPendingBatch(runningSession);
    await repository.interruptSession("demo-review", batch.batchId, {
      ...runningSession,
      status: "interrupted",
      endedAt: "2026-07-13T08:07:00.000Z",
    });
    const profile: LearningProfile = {
      subject_id: "demo-review",
      updated_at: "2026-07-13T08:10:00.000Z",
      total_questions: 0,
      total_correct: 0,
      accuracy: 0,
      profile_summary: "暂无长期画像。",
      weak_points: [],
      strengths: [],
      unverified_topics: [],
      recommendations: [],
      recent_sessions: ["session-1"],
    };

    await repository.saveLearningProfileAndArchive("demo-review", profile, [batch.batchId]);

    expect(await repository.loadLearningProfile("demo-review")).toEqual(profile);
    expect(await repository.listPendingBatches("demo-review")).toEqual([]);
    const archived = await readdir(resolve(dataRoot, "profile_families", "demo-review", "_user", "summaries", "archived"));
    expect(archived).toEqual([batch.batchId]);
  });

  it("画像校验失败时不消费 pending 批次", async () => {
    const batch = await repository.createPendingBatch(runningSession);
    await repository.interruptSession("demo-review", batch.batchId, {
      ...runningSession,
      status: "interrupted",
      endedAt: "2026-07-13T08:07:00.000Z",
    });
    const invalid = {
      subject_id: "another-subject",
      updated_at: "2026-07-13T08:10:00.000Z",
      total_questions: 0,
      total_correct: 0,
      accuracy: 0,
      profile_summary: "无效画像",
      weak_points: [],
      strengths: [],
      unverified_topics: [],
      recommendations: [],
      recent_sessions: [],
    } satisfies LearningProfile;

    await expect(repository.saveLearningProfileAndArchive("demo-review", invalid, [batch.batchId])).rejects.toThrow(
      "subject_id must be demo-review",
    );
    expect((await repository.listPendingBatches("demo-review")).map((item) => item.batchId)).toEqual([batch.batchId]);
    expect(await repository.loadLearningProfile("demo-review")).toBeNull();
  });

  it("多批次归档中途失败时恢复已移动记录和旧画像", async () => {
    let forwardMoves = 0;
    repository = new PrivateMemoryRepository({
      dataRoot,
      now: () => new Date("2026-07-13T08:09:10.000Z"),
      async renamePath(from, to) {
        if (/[\\/]pending[\\/]/u.test(from)) {
          forwardMoves += 1;
          if (forwardMoves === 2) throw new Error("simulated archive failure");
        }
        await rename(from, to);
      },
    });
    const first = await repository.createPendingBatch(runningSession);
    const secondSession = { ...runningSession, sessionId: "session-2" };
    const second = await repository.createPendingBatch(secondSession);
    await repository.interruptSession("demo-review", first.batchId, {
      ...runningSession,
      status: "interrupted",
      endedAt: "2026-07-13T08:10:00.000Z",
    });
    await repository.interruptSession("demo-review", second.batchId, {
      ...secondSession,
      status: "interrupted",
      endedAt: "2026-07-13T08:10:00.000Z",
    });
    const profile: LearningProfile = {
      subject_id: "demo-review",
      updated_at: "2026-07-13T08:10:00.000Z",
      total_questions: 0,
      total_correct: 0,
      accuracy: 0,
      profile_summary: "回滚测试画像",
      weak_points: [],
      strengths: [],
      unverified_topics: [],
      recommendations: [],
      recent_sessions: [],
    };

    await expect(repository.saveLearningProfileAndArchive(
      "demo-review",
      profile,
      [first.batchId, second.batchId],
    )).rejects.toThrow("simulated archive failure");

    expect((await repository.listPendingBatches("demo-review")).map((batch) => batch.batchId).sort())
      .toEqual([first.batchId, second.batchId].sort());
    expect(await repository.loadLearningProfile("demo-review")).toBeNull();
  });
});
