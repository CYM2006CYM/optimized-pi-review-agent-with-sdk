import { assertSafeRelativePath } from "../infrastructure/safe-files.js";

export type ProfileRevisionOperation = "create" | "update" | "delete";

export interface ProfileRevisionPlanItem {
  path: string;
  operation: ProfileRevisionOperation;
  reason: string;
}

export interface ProfileRevisionPlan {
  summary: string;
  requires_clarification: boolean;
  clarification_question: string;
  operations: ProfileRevisionPlanItem[];
  warnings: string[];
}

export interface ProfileRevisionChange extends ProfileRevisionPlanItem {
  content?: string;
}

export interface ProfileRevisionPatch {
  summary: string;
  changes: ProfileRevisionChange[];
  unresolved: string[];
}

export interface ProfileRevisionQualityReview {
  report_markdown: string;
  blocking_issues: string[];
  warnings: string[];
  recommendation: "enable" | "revise";
}

export interface ProfileFileSnapshot {
  path: string;
  content: string;
}

export interface ProfileStructureInspection {
  blockingIssues: string[];
  warnings: string[];
  metrics: {
    files: number;
    chapters: number;
    sections: number;
    knowledgePoints: number;
    cards: number;
    examPoints: number;
  };
}

export interface ProfileContentDifference {
  path: string;
  before: string | null;
  after: string | null;
}

const REQUIRED_FILES = new Set(["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"]);
const MUTABLE_ROOT_FILES = new Set(["subject.md", "knowledge_index.json", "source_map.json"]);
const MUTABLE_PREFIXES = ["cards/", "chapters/", "exam_points/"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMutableProfileContentPath(path: string): boolean {
  try {
    assertSafeRelativePath(path);
  } catch {
    return false;
  }
  const normalized = path.replaceAll("\\", "/");
  if (MUTABLE_ROOT_FILES.has(normalized)) return true;
  return MUTABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) && /\.(md|json)$/iu.test(normalized);
}

export function assertValidRevisionPlan(
  plan: ProfileRevisionPlan,
  existingPaths: readonly string[],
): void {
  if (typeof plan.summary !== "string" || plan.summary.trim() === "") throw new Error("Revision plan summary is required");
  if (!Array.isArray(plan.warnings) || plan.warnings.some((item) => typeof item !== "string")) {
    throw new Error("Revision plan warnings must be strings");
  }
  if (typeof plan.requires_clarification !== "boolean" || typeof plan.clarification_question !== "string") {
    throw new Error("Revision plan clarification fields are invalid");
  }
  if (!Array.isArray(plan.operations) || plan.operations.length > 12) {
    throw new Error("Revision plan operations must be an array with at most 12 items");
  }
  if (plan.requires_clarification) {
    if (plan.clarification_question.trim() === "") throw new Error("Revision clarification question is required");
    if (plan.operations.length !== 0) throw new Error("Revision plan requiring clarification must not contain operations");
    return;
  }
  if (plan.operations.length === 0) {
    throw new Error("Revision plan must contain at least one operation when clarification is not required");
  }
  const existing = new Set(existingPaths.map((path) => path.replaceAll("\\", "/")));
  const seen = new Set<string>();
  for (const operation of plan.operations) {
    const path = operation.path.replaceAll("\\", "/");
    if (!isMutableProfileContentPath(path)) throw new Error(`Revision path is not mutable: ${path}`);
    if (seen.has(path)) throw new Error(`Revision path is duplicated: ${path}`);
    seen.add(path);
    if (!(new Set<ProfileRevisionOperation>(["create", "update", "delete"])).has(operation.operation)) {
      throw new Error(`Unsupported revision operation: ${String(operation.operation)}`);
    }
    if (typeof operation.reason !== "string" || operation.reason.trim() === "") {
      throw new Error(`Revision reason is required: ${path}`);
    }
    if (operation.operation === "create" && existing.has(path)) throw new Error(`Revision create path already exists: ${path}`);
    if (operation.operation !== "create" && !existing.has(path)) throw new Error(`Revision path does not exist: ${path}`);
    if (operation.operation === "delete" && REQUIRED_FILES.has(path)) throw new Error(`Required Profile file cannot be deleted: ${path}`);
  }
}

export function assertValidRevisionPatch(
  patch: ProfileRevisionPatch,
  plan: ProfileRevisionPlan,
): void {
  if (typeof patch.summary !== "string" || patch.summary.trim() === "") throw new Error("Revision patch summary is required");
  if (!Array.isArray(patch.unresolved) || patch.unresolved.some((item) => typeof item !== "string")) {
    throw new Error("Revision patch unresolved must be strings");
  }
  if (!Array.isArray(patch.changes) || patch.changes.length !== plan.operations.length) {
    throw new Error("Revision patch must contain exactly the planned changes");
  }
  const expected = new Map(plan.operations.map((item) => [item.path.replaceAll("\\", "/"), item]));
  let totalCharacters = 0;
  for (const change of patch.changes) {
    const path = change.path.replaceAll("\\", "/");
    const planned = expected.get(path);
    if (!planned || planned.operation !== change.operation) throw new Error(`Revision patch exceeds plan: ${path}`);
    expected.delete(path);
    if (typeof change.reason !== "string" || change.reason.trim() === "") throw new Error(`Revision change reason is required: ${path}`);
    if (change.operation === "delete") {
      if (change.content !== undefined && change.content !== "") throw new Error(`Delete change must not contain content: ${path}`);
      continue;
    }
    if (typeof change.content !== "string" || change.content.trim() === "") {
      throw new Error(`Revision content is required: ${path}`);
    }
    const characters = Array.from(change.content).length;
    if (characters > 80_000) throw new Error(`Revision file exceeds 80000 characters: ${path}`);
    totalCharacters += characters;
  }
  if (expected.size > 0) throw new Error(`Revision patch omitted planned paths: ${[...expected.keys()].join(", ")}`);
  if (totalCharacters > 160_000) throw new Error("Revision patch exceeds total character budget");
}

export function inspectProfileStructure(files: readonly ProfileFileSnapshot[]): ProfileStructureInspection {
  const fileMap = new Map(files.map((file) => [file.path.replaceAll("\\", "/"), file.content]));
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  let chapters = 0;
  let sections = 0;
  let knowledgePoints = 0;
  const sectionIds = new Set<string>();
  const pointIds = new Set<string>();
  const relatedIds: Array<{ pointId: string; relatedId: string }> = [];
  const difficulties = new Set(["S-R", "S-U", "M-U", "M-A", "C-A"]);
  const questionTypes = new Set(["choice", "judgment", "short_answer"]);

  let index: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(fileMap.get("knowledge_index.json") ?? "") as unknown;
    if (isRecord(parsed)) index = parsed;
  } catch {
    // Canonical validator reports the syntax error; keep this inspection self-contained.
  }
  const chapterRecord = index && isRecord(index.chapters) ? index.chapters : undefined;
  if (!chapterRecord) {
    blockingIssues.push("knowledge_index.json 缺少 chapters object");
  } else {
    chapters = Object.keys(chapterRecord).length;
    for (const [chapterId, chapterValue] of Object.entries(chapterRecord)) {
      if (!isRecord(chapterValue)) {
        blockingIssues.push(`章节 ${chapterId} 不是 object`);
        continue;
      }
      const chapterSections = Array.isArray(chapterValue.sections) ? chapterValue.sections : [];
      const points = Array.isArray(chapterValue.knowledge_points) ? chapterValue.knowledge_points : [];
      if (chapterSections.length === 0) warnings.push(`章节 ${chapterId} 没有小节`);
      if (points.length === 0) warnings.push(`章节 ${chapterId} 没有知识点`);
      sections += chapterSections.length;
      knowledgePoints += points.length;
      for (const section of chapterSections) {
        if (!isRecord(section) || typeof section.path !== "string") {
          blockingIssues.push(`章节 ${chapterId} 包含无有效 path 的小节`);
        } else {
          const sectionPath = section.path.replaceAll("\\", "/");
          if (!isMutableProfileContentPath(sectionPath) || !sectionPath.startsWith("chapters/")) {
            blockingIssues.push(`小节路径不安全或不在 chapters/：${section.path}`);
          } else if (!fileMap.has(sectionPath)) {
            blockingIssues.push(`小节文件不存在：${section.path}`);
          }
        }
        if (!isRecord(section) || typeof section.id !== "string" || section.id.trim() === "") {
          blockingIssues.push(`章节 ${chapterId} 包含无有效 id 的小节`);
        } else if (sectionIds.has(section.id)) {
          blockingIssues.push(`小节 id 重复：${section.id}`);
        } else {
          sectionIds.add(section.id);
        }
      }
      for (const point of points) {
        if (!isRecord(point) || typeof point.id !== "string" || point.id.trim() === "") {
          blockingIssues.push(`章节 ${chapterId} 包含无有效 id 的知识点`);
          continue;
        }
        if (pointIds.has(point.id)) blockingIssues.push(`知识点 id 重复：${point.id}`);
        else pointIds.add(point.id);
        if (!difficulties.has(String(point.difficulty_baseline))) {
          blockingIssues.push(`知识点 ${point.id} 的 difficulty_baseline 无效`);
        }
        if (!Array.isArray(point.question_types) || point.question_types.length === 0
          || point.question_types.some((type) => typeof type !== "string" || !questionTypes.has(type))) {
          blockingIssues.push(`知识点 ${point.id} 的 question_types 无效`);
        }
        if (Array.isArray(point.related)) {
          for (const relatedId of point.related) {
            if (typeof relatedId === "string" && relatedId.trim() !== "") relatedIds.push({ pointId: point.id, relatedId });
          }
        }
        const cardId = typeof point.card_id === "string" && point.card_id.trim() !== "" ? point.card_id : point.id;
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(cardId)) {
          blockingIssues.push(`知识点 ${point.id} 的 card_id 不安全：${cardId}`);
        } else if (!fileMap.has(`cards/${cardId}.md`)) {
          blockingIssues.push(`知识点 ${point.id} 缺少卡片 cards/${cardId}.md`);
        }
      }
    }
    for (const related of relatedIds) {
      if (!pointIds.has(related.relatedId)) warnings.push(`知识点 ${related.pointId} 引用了未知 related ID：${related.relatedId}`);
    }
    if (chapters === 0) blockingIssues.push("资料包没有可学习章节");
    if (sections === 0) blockingIssues.push("资料包没有可学习小节");
    if (knowledgePoints === 0) blockingIssues.push("资料包没有可学习知识点");
  }

  try {
    const sourceMap = JSON.parse(fileMap.get("source_map.json") ?? "") as unknown;
    if (isRecord(sourceMap) && Array.isArray(sourceMap.sources) && isRecord(sourceMap.mappings)) {
      const sourceIds = new Set(sourceMap.sources
        .filter(isRecord)
        .map((source) => source.id)
        .filter((id): id is string => typeof id === "string"));
      for (const [path, ids] of Object.entries(sourceMap.mappings)) {
        if (!isMutableProfileContentPath(path) && path !== "quality_report.md") {
          blockingIssues.push(`source_map 映射路径不安全：${path}`);
        } else if (!fileMap.has(path)) {
          blockingIssues.push(`source_map 映射目标不存在：${path}`);
        }
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !sourceIds.has(id))) {
          blockingIssues.push(`source_map 映射包含未知 source ID：${path}`);
        }
      }
    }
  } catch {
    // Canonical validator reports invalid JSON.
  }

  const cardCount = [...fileMap.keys()].filter((path) => path.startsWith("cards/") && path.endsWith(".md")).length;
  const examPointCount = [...fileMap.keys()].filter((path) => path.startsWith("exam_points/") && path.endsWith(".md")).length;
  if (chapters > 0 && examPointCount < chapters) warnings.push(`考点总结数量 ${examPointCount} 少于章节数 ${chapters}`);

  return {
    blockingIssues: [...new Set(blockingIssues)],
    warnings: [...new Set(warnings)],
    metrics: {
      files: fileMap.size,
      chapters,
      sections,
      knowledgePoints,
      cards: cardCount,
      examPoints: examPointCount,
    },
  };
}

export function profileContentDifferences(
  beforeFiles: readonly ProfileFileSnapshot[],
  afterFiles: readonly ProfileFileSnapshot[],
  ignoredPaths: readonly string[] = ["profile.json", "quality_report.md"],
): ProfileContentDifference[] {
  const ignored = new Set(ignoredPaths);
  const before = new Map(beforeFiles.filter((file) => !ignored.has(file.path)).map((file) => [file.path, file.content]));
  const after = new Map(afterFiles.filter((file) => !ignored.has(file.path)).map((file) => [file.path, file.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  return paths
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => ({ path, before: before.get(path) ?? null, after: after.get(path) ?? null }));
}

export function plannedContentDifferences(
  beforeFiles: readonly ProfileFileSnapshot[],
  changes: readonly ProfileRevisionChange[],
): ProfileContentDifference[] {
  const before = new Map(beforeFiles.map((file) => [file.path, file.content]));
  return changes.map((change) => {
    const previous = before.get(change.path) ?? null;
    const after = change.operation === "delete" ? null : change.content ?? null;
    return { path: change.path, before: previous, after };
  }).filter((difference) => difference.before !== difference.after);
}
