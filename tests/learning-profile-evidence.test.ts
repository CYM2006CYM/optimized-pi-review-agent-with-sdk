import { describe, expect, it } from "vitest";
import {
  assembleLearningProfile,
  buildLearningProfileEvidence,
  type LearningProfileCandidate,
} from "../src/domain/learning-profile-evidence.js";
import type { Attempt, LearningProfile, StudySession } from "../src/domain/types.js";
import type { PendingLearningRecordBatch } from "../src/repositories/private-memory-repository.js";

const session: StudySession = {
  sessionId: "session-new",
  subjectId: "demo-review",
  status: "completed",
  mode: "practice",
  scope: "第 1 章",
  scopeHistory: [{ scopeId: "chapter:1", scopeLabel: "第 1 章", enteredAt: "2026-07-14T08:00:00.000Z" }],
  totalQuestions: 1,
  correct: 1,
  incorrect: 0,
  createdAt: "2026-07-14T08:00:00.000Z",
  updatedAt: "2026-07-14T08:10:00.000Z",
  endedAt: "2026-07-14T08:10:00.000Z",
};

const attempt: Attempt = {
  question_id: "question-new",
  session_id: session.sessionId,
  scope_id: "chapter:1",
  scope_label: "第 1 章",
  target_kind: "scope",
  target_id: "chapter:1",
  target_label: "第 1 章",
  knowledge_points: ["active_recall"],
  difficulty: "S-U",
  type: "short_answer",
  timestamp: "2026-07-14T08:05:00.000Z",
  question_text: "什么是主动回忆？",
  user_answer: "RAW-USER-ANSWER",
  answer_history: [{
    answer: "RAW-HISTORY-ANSWER",
    is_correct: true,
    grading: "正确",
    timestamp: "2026-07-14T08:05:00.000Z",
  }],
  correct_answer: "RAW-CORRECT-ANSWER",
  explanation_l1: "RAW-EXPLANATION",
  source_basis: "RAW-SOURCE",
  outcome: "correct",
  is_correct: true,
  knowledge_chain_l3: [],
  suggestion_next: "继续",
};

const batch: PendingLearningRecordBatch = {
  batchId: "batch-new",
  subjectId: "demo-review",
  sessionId: session.sessionId,
  directory: "C:\\data\\batch-new",
  session,
  attempts: [attempt],
  summaryMarkdown: "# 会话总结\n\n掌握了主动回忆。",
};

const existing: LearningProfile = {
  subject_id: "demo-review",
  updated_at: "2026-07-13T08:00:00.000Z",
  total_questions: 2,
  total_correct: 1,
  accuracy: 0.5,
  profile_summary: "已有画像",
  weak_points: ["旧薄弱点"],
  strengths: ["旧掌握点"],
  unverified_topics: [],
  recommendations: ["旧建议"],
  recent_sessions: ["session-old"],
};

const candidate: LearningProfileCandidate = {
  profile_summary: "累计记录显示已获得主动回忆的掌握证据。",
  weak_points: [],
  strengths: ["主动回忆"],
  unverified_topics: [],
  recommendations: ["继续练习主动回忆"],
};

describe("LearningProfileEvidence", () => {
  it("只投影会话总结和 SessionEvidence，不包含原始答案与参考答案", () => {
    const evidence = buildLearningProfileEvidence("demo-review", existing, [batch]);
    const serialized = JSON.stringify(evidence);

    expect(serialized).toContain("掌握了主动回忆");
    expect(serialized).not.toContain("RAW-USER-ANSWER");
    expect(serialized).not.toContain("RAW-HISTORY-ANSWER");
    expect(serialized).not.toContain("RAW-CORRECT-ANSWER");
    expect(serialized).not.toContain("RAW-EXPLANATION");
    expect(serialized).not.toContain("RAW-SOURCE");
  });

  it("累计题数、正确数和正确率由代码确定并合并历史画像", () => {
    const evidence = buildLearningProfileEvidence("demo-review", existing, [batch]);
    const profile = assembleLearningProfile(evidence, candidate, "2026-07-14T09:00:00.000Z");

    expect(profile).toMatchObject({
      total_questions: 3,
      total_correct: 2,
      accuracy: 2 / 3,
      recent_sessions: ["session-old", "session-new"],
      strengths: ["主动回忆"],
    });
  });

  it("拒绝 running 或其他科目的记录", () => {
    expect(() => buildLearningProfileEvidence("demo-review", null, [{
      ...batch,
      session: { ...session, status: "running", endedAt: undefined },
    }])).toThrow("running batch");
    expect(() => buildLearningProfileEvidence("another", null, [batch])).toThrow("another subject");
  });
});
