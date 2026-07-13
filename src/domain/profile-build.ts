import type { DifficultyLevel, QuestionType } from "./types.js";
import type { SourceInventory } from "./source-inventory.js";

export interface ProfileBuildKnowledgePoint {
  id: string;
  name: string;
  aliases: string[];
  tags: string[];
  definition: string;
  key_points: string[];
  common_misconceptions: string[];
  related: string[];
  question_types: Array<Exclude<QuestionType, "multi_choice">>;
  difficulty_baseline: DifficultyLevel;
  source_ids: string[];
}

export interface ProfileBuildSection {
  title: string;
  markdown: string;
  source_ids: string[];
  knowledge_points: ProfileBuildKnowledgePoint[];
}

export interface ProfileBuildChapter {
  title: string;
  source_ids: string[];
  sections: ProfileBuildSection[];
}

export interface ProfileBuildFragment {
  subject_overview: string;
  chapters: ProfileBuildChapter[];
  warnings: string[];
}

export interface CanonicalProfileBuild {
  files: Map<string, string>;
  metrics: {
    chapters: number;
    sections: number;
    knowledgePoints: number;
    cards: number;
    examPoints: number;
    mappedSources: number;
    warnings: string[];
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function normalizedKey(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
}

function safeKnowledgePointId(value: string, fallbackIndex: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return normalized || `kp-${String(fallbackIndex).padStart(3, "0")}`;
}

function frontmatter(values: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}: ${typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function assembleCanonicalProfile(
  subjectName: string,
  inventory: SourceInventory,
  fragments: readonly ProfileBuildFragment[],
): CanonicalProfileBuild {
  if (fragments.length === 0) throw new Error("Profile build requires at least one semantic fragment");
  const validSourceIds = new Set(inventory.files.map((file) => file.sourceId));
  const warnings = unique(fragments.flatMap((fragment) => fragment.warnings));
  const chapterMap = new Map<string, ProfileBuildChapter>();
  for (const fragment of fragments) {
    for (const chapter of fragment.chapters) {
      const chapterKey = normalizedKey(chapter.title);
      if (!chapterKey) continue;
      let mergedChapter = chapterMap.get(chapterKey);
      if (!mergedChapter) {
        mergedChapter = { title: chapter.title.trim(), source_ids: [], sections: [] };
        chapterMap.set(chapterKey, mergedChapter);
      }
      mergedChapter.source_ids = unique([...mergedChapter.source_ids, ...chapter.source_ids])
        .filter((id) => validSourceIds.has(id));
      for (const section of chapter.sections) {
        const sectionKey = normalizedKey(section.title);
        if (!sectionKey) continue;
        let mergedSection = mergedChapter.sections.find((item) => normalizedKey(item.title) === sectionKey);
        if (!mergedSection) {
          mergedSection = { title: section.title.trim(), markdown: section.markdown.trim(), source_ids: [], knowledge_points: [] };
          mergedChapter.sections.push(mergedSection);
        } else if (!mergedSection.markdown.includes(section.markdown.trim())) {
          mergedSection.markdown = `${mergedSection.markdown}\n\n${section.markdown.trim()}`.trim();
        }
        mergedSection.source_ids = unique([...mergedSection.source_ids, ...section.source_ids])
          .filter((id) => validSourceIds.has(id));
        for (const point of section.knowledge_points) {
          const pointKey = normalizedKey(point.id || point.name);
          const existing = mergedSection.knowledge_points.find((item) => normalizedKey(item.id || item.name) === pointKey);
          if (!existing) {
            mergedSection.knowledge_points.push({
              ...point,
              aliases: unique(point.aliases),
              tags: unique(point.tags),
              key_points: unique(point.key_points),
              common_misconceptions: unique(point.common_misconceptions),
              related: unique(point.related),
              question_types: unique(point.question_types) as ProfileBuildKnowledgePoint["question_types"],
              source_ids: unique(point.source_ids).filter((id) => validSourceIds.has(id)),
            });
          } else {
            existing.aliases = unique([...existing.aliases, ...point.aliases]);
            existing.tags = unique([...existing.tags, ...point.tags]);
            existing.key_points = unique([...existing.key_points, ...point.key_points]);
            existing.common_misconceptions = unique([...existing.common_misconceptions, ...point.common_misconceptions]);
            existing.related = unique([...existing.related, ...point.related]);
            existing.source_ids = unique([...existing.source_ids, ...point.source_ids]).filter((id) => validSourceIds.has(id));
          }
        }
      }
    }
  }
  if (chapterMap.size === 0) throw new Error("Profile build produced no chapters");

  const files = new Map<string, string>();
  const knowledgeIndex: { subject: string; chapters: Record<string, unknown> } = { subject: subjectName, chapters: {} };
  const sourceMappings: Record<string, string[]> = {};
  const usedPointIds = new Set<string>();
  let pointIndex = 0;
  let sectionCount = 0;
  let pointCount = 0;

  const overview = unique(fragments.map((fragment) => fragment.subject_overview)).join("\n\n");
  files.set("subject.md", `# ${subjectName}\n\n${overview}\n`);

  for (const [chapterOffset, chapter] of [...chapterMap.values()].entries()) {
    const chapterNumber = chapterOffset + 1;
    const chapterId = String(chapterNumber);
    const chapterPadded = String(chapterNumber).padStart(2, "0");
    const sectionRecords: unknown[] = [];
    const pointRecords: unknown[] = [];
    const examLines = [`# 第 ${chapterNumber} 章 · ${chapter.title} 考点`, ""];
    for (const [sectionOffset, section] of chapter.sections.entries()) {
      sectionCount += 1;
      const sectionNumber = sectionOffset + 1;
      const sectionLabel = `${chapterNumber}.${sectionNumber}`;
      const sectionId = `ch${chapterPadded}-sec${String(sectionNumber).padStart(2, "0")}`;
      const sectionPath = `chapters/${chapterPadded}/${chapterPadded}.${String(sectionNumber).padStart(2, "0")}.md`;
      sectionRecords.push({ id: sectionId, section: sectionLabel, title: section.title, path: sectionPath });
      const sectionSourceIds = unique([...chapter.source_ids, ...section.source_ids]);
      files.set(sectionPath, `${frontmatter({
        id: sectionId,
        chapter: chapterId,
        section: sectionLabel,
        title: section.title,
        status: "draft",
        source_ids: sectionSourceIds,
      })}\n\n# ${section.title}\n\n${section.markdown}\n`);
      sourceMappings[sectionPath] = sectionSourceIds;

      for (const point of section.knowledge_points) {
        pointIndex += 1;
        pointCount += 1;
        let pointId = safeKnowledgePointId(point.id || point.name, pointIndex);
        for (let suffix = 2; usedPointIds.has(pointId); suffix += 1) pointId = `${safeKnowledgePointId(point.id || point.name, pointIndex)}-${suffix}`;
        usedPointIds.add(pointId);
        const pointSourceIds = unique([...sectionSourceIds, ...point.source_ids]);
        const cardPath = `cards/${pointId}.md`;
        pointRecords.push({
          id: pointId,
          name: point.name,
          aliases: unique(point.aliases),
          tags: unique(point.tags),
          chapter: chapterId,
          section: sectionLabel,
          card_id: pointId,
          question_types: point.question_types.length > 0 ? point.question_types : ["short_answer"],
          difficulty_baseline: point.difficulty_baseline,
          related: unique(point.related),
          common_misconceptions: unique(point.common_misconceptions),
        });
        files.set(cardPath, `${frontmatter({
          id: pointId,
          name: point.name,
          aliases: unique(point.aliases),
          difficulty: point.difficulty_baseline,
          tags: unique(point.tags),
          chapter: chapterId,
          section: sectionLabel,
          source_ids: pointSourceIds,
          status: "draft",
        })}\n\n# ${point.name}\n\n## 定义\n\n${point.definition}\n\n## 关键要点\n\n${point.key_points.map((item) => `- ${item}`).join("\n") || "- 暂无"}\n\n## 常见误区\n\n${point.common_misconceptions.map((item) => `- ${item}`).join("\n") || "- 暂无"}\n`);
        sourceMappings[cardPath] = pointSourceIds;
        examLines.push(`- **${point.name}**：${point.key_points[0] ?? point.definition}`);
      }
    }
    const examPath = `exam_points/${chapterPadded}.md`;
    files.set(examPath, `${frontmatter({
      id: `exam-ch${chapterPadded}`,
      chapter: chapterId,
      title: `${chapter.title}考点总结`,
      status: "draft",
      source_ids: chapter.source_ids,
    })}\n\n${examLines.join("\n")}\n`);
    sourceMappings[examPath] = chapter.source_ids;
    knowledgeIndex.chapters[chapterId] = {
      id: chapterId,
      title: chapter.title,
      sections: sectionRecords,
      knowledge_points: pointRecords,
    };
  }

  files.set("knowledge_index.json", `${JSON.stringify(knowledgeIndex, null, 2)}\n`);
  const sourceMap = {
    sources: inventory.files.map((file) => ({
      id: file.sourceId,
      path: file.relativePath,
      type: /\.md$/iu.test(file.relativePath) ? "markdown" : "text",
      sha256: file.sha256,
      bytes: file.bytes,
      status: "available",
    })),
    mappings: sourceMappings,
    unmapped_sources: inventory.files.filter((file) => !Object.values(sourceMappings).some((ids) => ids.includes(file.sourceId))).map((file) => file.sourceId),
    uncertain_mappings: {},
  };
  files.set("source_map.json", `${JSON.stringify(sourceMap, null, 2)}\n`);
  files.set("quality_report.md", `# ${subjectName} 质量报告

## 结构检查

- 章节数：${chapterMap.size}
- 小节数：${sectionCount}
- 知识点/卡片数：${pointCount}
- 考点总结数：${chapterMap.size}
- 来源文件数：${inventory.files.length}
- 未映射来源数：${sourceMap.unmapped_sources.length}

## 语义构建警告

${warnings.length > 0 ? warnings.map((item) => `- ${item}`).join("\n") : "- 无"}
`);

  return {
    files,
    metrics: {
      chapters: chapterMap.size,
      sections: sectionCount,
      knowledgePoints: pointCount,
      cards: pointCount,
      examPoints: chapterMap.size,
      mappedSources: inventory.files.length - sourceMap.unmapped_sources.length,
      warnings,
    },
  };
}
