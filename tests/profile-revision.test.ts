import { describe, expect, it } from "vitest";
import {
  assertValidRevisionPatch,
  assertValidRevisionPlan,
  inspectProfileStructure,
  type ProfileRevisionPlan,
} from "../src/domain/profile-revision.js";

const plan: ProfileRevisionPlan = {
  summary: "修订主动回忆说明",
  requires_clarification: false,
  clarification_question: "",
  operations: [{ path: "subject.md", operation: "update", reason: "补充定义" }],
  warnings: [],
};

describe("Profile revision domain", () => {
  it("计划只允许安全 canonical 内容路径并支持先澄清", () => {
    expect(() => assertValidRevisionPlan(plan, ["subject.md"])).not.toThrow();
    expect(() => assertValidRevisionPlan({
      ...plan,
      requires_clarification: true,
      clarification_question: "要修改哪个知识点？",
      operations: [],
    }, ["subject.md"])).not.toThrow();
    expect(() => assertValidRevisionPlan({
      ...plan,
      operations: [{ path: "profile.json", operation: "update", reason: "越权" }],
    }, ["profile.json"])).toThrow("not mutable");
    expect(() => assertValidRevisionPlan({
      ...plan,
      operations: [{ path: "../escape.md", operation: "create", reason: "越界" }],
    }, ["subject.md"])).toThrow("not mutable");
  });

  it("补丁必须严格覆盖计划且不能夹带其他文件", () => {
    expect(() => assertValidRevisionPatch({
      summary: "已修订",
      changes: [{ path: "subject.md", operation: "update", reason: "补充定义", content: "# 新说明\n" }],
      unresolved: [],
    }, plan)).not.toThrow();
    expect(() => assertValidRevisionPatch({
      summary: "夹带修改",
      changes: [{ path: "source_map.json", operation: "update", reason: "夹带", content: "{}" }],
      unresolved: [],
    }, plan)).toThrow("exceeds plan");
  });

  it("结构检查发现缺失 section/card 和未知 source ID", () => {
    const inspection = inspectProfileStructure([
      { path: "subject.md", content: "# 科目\n" },
      { path: "quality_report.md", content: "# 质量\n" },
      {
        path: "knowledge_index.json",
        content: JSON.stringify({
          chapters: {
            "1": {
              sections: [{ path: "chapters/01/missing.md" }],
              knowledge_points: [{ id: "active-recall", card_id: "active-recall" }],
            },
          },
        }),
      },
      {
        path: "source_map.json",
        content: JSON.stringify({
          sources: [{ id: "source-1" }],
          mappings: { "chapters/01/missing.md": ["unknown-source"] },
        }),
      },
    ]);

    expect(inspection.blockingIssues).toContain("小节文件不存在：chapters/01/missing.md");
    expect(inspection.blockingIssues).toContain("知识点 active-recall 缺少卡片 cards/active-recall.md");
    expect(inspection.blockingIssues).toContain("source_map 映射包含未知 source ID：chapters/01/missing.md");
  });
});
