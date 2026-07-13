import { describe, expect, it } from "vitest";
import {
  SESSION_EVIDENCE_LIMITS,
  boundedUniqueStrings,
  buildSessionEvidence,
  truncateEvidenceText,
} from "../src/domain/session-evidence.js";
import type { Attempt, StudySession } from "../src/domain/types.js";

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    sessionId: "session-1",
    subjectId: "demo-review",
    status: "completed",
    mode: "practice",
    scope: "第 1 章",
    scopeHistory: [{
      scopeId: "chapter:1",
      scopeLabel: "第 1 章",
      enteredAt: "2026-07-13T08:00:00.000Z",
    }],
    totalQuestions: 1,
    correct: 1,
    incorrect: 0,
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T08:10:00.000Z",
    endedAt: "2026-07-13T08:10:00.000Z",
    ...overrides,
  };
}

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    question_id: "question-1",
    session_id: "session-1",
    scope_id: "chapter:1",
    scope_label: "第 1 章",
    target_kind: "scope",
    target_id: "chapter:1",
    target_label: "第 1 章",
    knowledge_points: ["active_recall"],
    difficulty: "S-U",
    type: "short_answer",
    timestamp: "2026-07-13T08:05:00.000Z",
    question_text: "什么是主动回忆？",
    user_answer: "不看答案主动提取",
    answer_history: [{
      answer: "不看答案主动提取",
      is_correct: true,
      grading: "回答正确",
      timestamp: "2026-07-13T08:05:00.000Z",
    }],
    correct_answer: "主动从记忆中提取信息",
    explanation_l1: "通过提取强化记忆",
    source_basis: "cards/active_recall.md",
    outcome: "correct",
    is_correct: true,
    knowledge_chain_l3: ["提取练习", "反馈"],
    suggestion_next: "继续",
    ...overrides,
  };
}

describe("session evidence projection", () => {
  it("excludes raw answers and creates bounded mastery evidence after a retry", () => {
    const secret = "RAW-ANSWER-MUST-NOT-LEAK";
    const input = attempt({
      question_text: `解释主动回忆 ${"很长".repeat(200)}`,
      user_answer: `${secret}-${"答案".repeat(1_000)}`,
      answer_history: [
        { answer: `${secret}-first`, is_correct: false, grading: "错误", timestamp: "2026-07-13T08:04:00.000Z" },
        { answer: `${secret}-second`, is_correct: true, grading: "正确", timestamp: "2026-07-13T08:05:00.000Z" },
      ],
      correct_answer: `${secret}-correct-answer`,
      explanation_l1: `${secret}-explanation`,
      source_basis: `${secret}-source`,
      discussion_summary: {
        core_misconception: `${secret}-misconception`,
        clarified_points: ["区分提取与再认"],
        user_self_correction: `${secret}-self-correction`,
        lingering_questions: [`${secret}-question`],
      },
    });

    const evidence = buildSessionEvidence(session(), [input]);
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain(secret);
    for (const forbiddenKey of [
      "user_answer",
      "answer_history",
      "user_self_correction",
      "correct_answer",
      "explanation_l1",
      "source_basis",
    ]) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
    expect(evidence.totals).toMatchObject({ questions: 1, correct: 1, gave_up: 0, submissions: 2, revisions: 1 });
    expect(evidence.observed_facts[0]).toMatchObject({ submission_count: 2, incorrect_submissions: 1 });
    expect(evidence.mastery_evidence).toHaveLength(1);
    expect(evidence.unverified_topics).toHaveLength(0);
    expect(Array.from(evidence.observed_facts[0]!.question_excerpt)).toHaveLength(SESSION_EVIDENCE_LIMITS.questionExcerpt);
  });

  it("treats gave_up only as unverified rather than mastery or weakness", () => {
    const evidence = buildSessionEvidence(session({ correct: 0, incorrect: 1 }), [attempt({
      outcome: "gave_up",
      is_correct: false,
      user_answer: "",
      answer_history: [],
    })]);
    const serialized = JSON.stringify(evidence);

    expect(evidence.mastery_evidence).toEqual([]);
    expect(evidence.unverified_topics).toEqual([expect.objectContaining({
      reason: "gave_up_without_correct_answer",
      knowledge_points: ["active_recall"],
    })]);
    expect(evidence.totals).toMatchObject({ correct: 0, gave_up: 1, submissions: 0 });
    expect(serialized).not.toContain("weak");
    expect(serialized).not.toContain("薄弱");
  });

  it("preserves each question scope even when the session current scope changed", () => {
    const evidence = buildSessionEvidence(session({
      scope: "第 2 章",
      scopeHistory: [
        { scopeId: "chapter:1", scopeLabel: "第 1 章", enteredAt: "2026-07-13T08:00:00.000Z" },
        { scopeId: "chapter:2", scopeLabel: "第 2 章", enteredAt: "2026-07-13T08:06:00.000Z" },
      ],
      totalQuestions: 2,
      correct: 1,
      incorrect: 1,
    }), [
      attempt(),
      attempt({
        question_id: "question-2",
        scope_id: "chapter:2",
        scope_label: "第 2 章",
        outcome: "gave_up",
        is_correct: false,
        answer_history: [],
      }),
    ]);

    expect(evidence.observed_facts.map((item) => item.scope.scope_id)).toEqual(["chapter:1", "chapter:2"]);
    expect(evidence.scopes).toEqual([
      expect.objectContaining({ scope: { scope_id: "chapter:1", scope_label: "第 1 章" }, questions: 1, correct: 1, gave_up: 0 }),
      expect.objectContaining({ scope: { scope_id: "chapter:2", scope_label: "第 2 章" }, questions: 1, correct: 0, gave_up: 1 }),
    ]);
  });

  it("bounds and deduplicates discussion and knowledge point strings", () => {
    const longPoint = `知识点-${"甲".repeat(200)}`;
    const longClarification = `澄清-${"乙".repeat(300)}`;
    const evidence = buildSessionEvidence(session(), [attempt({
      knowledge_points: [longPoint, longPoint, "active_recall", "active_recall"],
      discussion_summary: {
        core_misconception: "不进入投影",
        clarified_points: [longClarification, longClarification, "另一个澄清", "", "另一个澄清"],
        user_self_correction: "不进入投影",
        lingering_questions: ["不进入投影"],
      },
    })]);

    const observation = evidence.observed_facts[0]!;
    expect(observation.knowledge_points).toHaveLength(2);
    expect(observation.clarified_points).toHaveLength(2);
    expect(Array.from(observation.knowledge_points[0]!)).toHaveLength(SESSION_EVIDENCE_LIMITS.knowledgePoint);
    expect(Array.from(observation.clarified_points[0]!)).toHaveLength(SESSION_EVIDENCE_LIMITS.clarifiedPoint);
    expect(evidence.totals.discussed_questions).toBe(1);
  });

  it("returns an explicit empty evidence set for an empty session", () => {
    const evidence = buildSessionEvidence(session({ totalQuestions: 0, correct: 0 }), []);
    expect(evidence.totals).toEqual({
      questions: 0,
      correct: 0,
      gave_up: 0,
      submissions: 0,
      revisions: 0,
      discussed_questions: 0,
    });
    expect(evidence.observed_facts).toEqual([]);
    expect(evidence.mastery_evidence).toEqual([]);
    expect(evidence.unverified_topics).toEqual([]);
  });

  it("rejects attempts from another session or with inconsistent outcomes", () => {
    expect(() => buildSessionEvidence(session(), [attempt({ session_id: "other" })]))
      .toThrow("belongs to another session");
    expect(() => buildSessionEvidence(session(), [attempt({ outcome: "correct", is_correct: false })]))
      .toThrow("outcome=correct but is_correct=false");
    expect(() => buildSessionEvidence(session(), [attempt({ outcome: "gave_up", is_correct: true })]))
      .toThrow("outcome=gave_up but is_correct=true");
  });

  it("is deterministic, does not mutate inputs, and truncates Unicode safely", () => {
    const sourceSession = session();
    const sourceAttempts = [attempt({ question_text: "😀".repeat(300) })];
    const before = JSON.stringify({ sourceSession, sourceAttempts });

    const first = buildSessionEvidence(sourceSession, sourceAttempts);
    const second = buildSessionEvidence(sourceSession, sourceAttempts);

    expect(first).toEqual(second);
    expect(JSON.stringify({ sourceSession, sourceAttempts })).toBe(before);
    expect(Array.from(first.observed_facts[0]!.question_excerpt)).toHaveLength(SESSION_EVIDENCE_LIMITS.questionExcerpt);
    expect(first.observed_facts[0]!.question_excerpt).not.toContain("�");
    expect(truncateEvidenceText("  A\n\tB  ", 10)).toBe("A B");
    expect(boundedUniqueStrings([" A ", "A", "B"], { maxItems: 2, maxCharacters: 10 })).toEqual(["A", "B"]);
  });
});
