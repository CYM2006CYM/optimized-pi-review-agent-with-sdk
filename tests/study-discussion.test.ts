import { describe, expect, it } from "vitest";
import { buildDiscussionAgentInput } from "../src/application/study-discussion.js";
import type { GradeResult, ReviewQuestion } from "../src/domain/types.js";

const SECRET_ANSWER = "SECRET-CORRECT-ANSWER";
const SECRET_EXPLANATION = "SECRET-EXPLANATION";
const SECRET_SOURCE = "SECRET-SOURCE";

const question: ReviewQuestion & { question_id: string } = {
  question_id: "q1",
  knowledge_points: ["active_recall"],
  difficulty: "S-U",
  type: "short_answer",
  question_text: "什么是主动回忆？",
  correct_answer: SECRET_ANSWER,
  explanation_l1: SECRET_EXPLANATION,
  source_basis: SECRET_SOURCE,
  related_knowledge_chain: ["spaced_review"],
};

const grade: GradeResult = {
  is_correct: false,
  correct_answer: SECRET_ANSWER,
  explanation_l1: SECRET_EXPLANATION,
  knowledge_chain_l3: ["SECRET-CHAIN"],
  suggestion_next: "SECRET-SUGGESTION",
  grading: "SECRET-GRADING",
};

describe("buildDiscussionAgentInput", () => {
  it("订正前不向讨论 Agent 传入答案、解析、来源或原始判题", () => {
    const input = buildDiscussionAgentInput(question, grade, "我的答案", "给我一点提示", false);
    const visible = JSON.stringify(input);

    expect(input.revealAnswer).toBe(false);
    expect(visible).toContain("什么是主动回忆");
    expect(visible).not.toContain(SECRET_ANSWER);
    expect(visible).not.toContain(SECRET_EXPLANATION);
    expect(visible).not.toContain(SECRET_SOURCE);
    expect(visible).not.toContain("SECRET-GRADING");
  });

  it("题目结束后允许完整答案上下文用于消化讨论", () => {
    const input = buildDiscussionAgentInput(question, grade, "我的答案", "请解释", true);
    const visible = JSON.stringify(input);

    expect(input.revealAnswer).toBe(true);
    expect(visible).toContain(SECRET_ANSWER);
    expect(visible).toContain(SECRET_EXPLANATION);
    expect(visible).toContain(SECRET_SOURCE);
  });
});
