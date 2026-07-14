import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_POLICIES,
  REVIEW_MODE_POLICIES,
  getDifficultyPolicy,
  getReviewModePolicy,
} from "../src/domain/study-policy.js";

describe("study policy", () => {
  it("为全部五级难度提供固定中文语义和可消费的出题约束", () => {
    expect(Object.keys(DIFFICULTY_POLICIES)).toEqual(["S-R", "S-U", "M-U", "M-A", "C-A"]);

    for (const level of Object.keys(DIFFICULTY_POLICIES)) {
      const policy = getDifficultyPolicy(level);
      expect(policy.level).toBe(level);
      expect(policy.label).toMatch(/[\u4e00-\u9fff]/u);
      expect(policy.learningGoal.length).toBeGreaterThan(10);
      expect(policy.questionConstraints.length).toBeGreaterThanOrEqual(2);
      expect(policy.questionConstraints.every((constraint) => constraint.length > 0)).toBe(true);
    }
  });

  it("难度从识记、理解到复杂应用形成不同约束", () => {
    expect(getDifficultyPolicy("S-R").learningGoal).toContain("回忆");
    expect(getDifficultyPolicy("S-U").learningGoal).toContain("自己的话");
    expect(getDifficultyPolicy("M-U").questionConstraints.join("\n")).toContain("两个或三个");
    expect(getDifficultyPolicy("M-A").learningGoal).toContain("情境");
    expect(getDifficultyPolicy("C-A").questionConstraints.join("\n")).toContain("至少三个");
  });

  it("为三种学习方式提供不同的进入行为、出题约束和回答建议", () => {
    expect(Object.keys(REVIEW_MODE_POLICIES).sort()).toEqual([
      "card_practice",
      "chapter_study",
      "practice",
    ]);

    const policies = Object.keys(REVIEW_MODE_POLICIES).map(getReviewModePolicy);
    expect(new Set(policies.map((policy) => policy.entryBehavior)).size).toBe(3);
    expect(new Set(policies.map((policy) => policy.answerGuidance.style)).size).toBe(3);
    expect(new Set(policies.map((policy) => policy.answerGuidance.recommendedLength)).size).toBe(3);
    for (const policy of policies) {
      expect(policy.label).toMatch(/[\u4e00-\u9fff]/u);
      expect(policy.questionConstraints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("卡片练习要求先提示后回忆，章节学习要求先展示材料", () => {
    const card = getReviewModePolicy("card_practice");
    const chapter = getReviewModePolicy("chapter_study");

    expect(card.entryBehavior).toContain("卡片正面");
    expect(card.entryBehavior).toContain("不展示卡片背面");
    expect(chapter.entryBehavior).toContain("先展示");
    expect(chapter.entryBehavior).toContain("章节");
  });

  it("非法难度和学习方式立即抛出含输入值的错误", () => {
    expect(() => getDifficultyPolicy("M-E")).toThrowError(new RangeError("不支持的难度等级：M-E"));
    expect(() => getReviewModePolicy("free_chat")).toThrowError(new RangeError("不支持的学习方式：free_chat"));
  });
});
