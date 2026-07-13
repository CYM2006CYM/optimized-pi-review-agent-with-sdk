import { describe, expect, it } from "vitest";
import { assembleCanonicalProfile, type ProfileBuildFragment } from "../src/domain/profile-build.js";
import type { SourceInventory } from "../src/domain/source-inventory.js";

const inventory: SourceInventory = {
  root: "C:\\sources",
  totalBytes: 100,
  totalCharacters: 80,
  files: [{
    sourceId: "src-001-abcdef123456",
    relativePath: "notes.md",
    sha256: "a".repeat(64),
    bytes: 100,
    characters: 80,
  }],
};

const fragment: ProfileBuildFragment = {
  subject_overview: "学习方法包含记忆与反馈。",
  warnings: [],
  chapters: [{
    title: "记忆方法",
    source_ids: ["src-001-abcdef123456"],
    sections: [{
      title: "主动回忆",
      markdown: "主动回忆要求先尝试提取，再查看答案。",
      source_ids: ["src-001-abcdef123456"],
      knowledge_points: [{
        id: "active-recall",
        name: "主动回忆",
        aliases: ["检索练习"],
        tags: ["记忆"],
        definition: "先不看答案，从记忆中提取知识。",
        key_points: ["先提取", "再反馈"],
        common_misconceptions: ["重复阅读等于掌握"],
        related: [],
        question_types: ["short_answer", "judgment"],
        difficulty_baseline: "S-U",
        source_ids: ["src-001-abcdef123456"],
      }],
    }],
  }],
};

describe("assembleCanonicalProfile", () => {
  it("组装 canonical index、章节、卡片、考点和来源映射", () => {
    const build = assembleCanonicalProfile("学习方法", inventory, [fragment]);

    expect([...build.files.keys()].sort()).toEqual([
      "cards/active-recall.md",
      "chapters/01/01.01.md",
      "exam_points/01.md",
      "knowledge_index.json",
      "quality_report.md",
      "source_map.json",
      "subject.md",
    ]);
    expect(build.files.get("cards/active-recall.md")).toContain("# 主动回忆");
    expect(build.files.get("chapters/01/01.01.md")).toContain("source_ids");
    const index = JSON.parse(build.files.get("knowledge_index.json")!);
    expect(index.chapters["1"].knowledge_points[0]).toMatchObject({
      id: "active-recall",
      card_id: "active-recall",
      section: "1.1",
    });
    const sourceMap = JSON.parse(build.files.get("source_map.json")!);
    expect(sourceMap.mappings["cards/active-recall.md"]).toEqual(["src-001-abcdef123456"]);
    expect(sourceMap.unmapped_sources).toEqual([]);
    expect(build.metrics).toMatchObject({ chapters: 1, sections: 1, knowledgePoints: 1, mappedSources: 1 });
  });

  it("合并跨批次同名章节和小节", () => {
    const second: ProfileBuildFragment = {
      subject_overview: "补充说明。",
      warnings: ["第二批资料较短"],
      chapters: [{
        ...fragment.chapters[0]!,
        sections: [{
          ...fragment.chapters[0]!.sections[0]!,
          markdown: "补充：反馈后需要再次练习。",
        }],
      }],
    };
    const build = assembleCanonicalProfile("学习方法", inventory, [fragment, second]);

    expect(build.metrics.chapters).toBe(1);
    expect(build.metrics.sections).toBe(1);
    expect(build.metrics.knowledgePoints).toBe(1);
    expect(build.files.get("chapters/01/01.01.md")).toContain("补充：反馈后需要再次练习");
    expect(build.metrics.warnings).toEqual(["第二批资料较短"]);
  });
});
