import type { Profile } from "./types.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

interface KnowledgePointRecord {
  id: string;
  name: string;
  card_id?: string;
  section?: string;
}

interface SectionRecord {
  id: string;
  section: string;
  title: string;
  path?: string;
}

interface ChapterRecord {
  id: string;
  title: string;
  sections?: SectionRecord[];
  knowledge_points?: KnowledgePointRecord[];
}

interface KnowledgeIndexRecord {
  chapters: Record<string, ChapterRecord>;
}

export interface StudyScopeOption {
  id: string;
  label: string;
  chapterId: string;
  knowledgePointIds: string[];
  materialPaths: string[];
  cards: StudyCardOption[];
  sections: StudySectionOption[];
}

export interface StudyCardOption {
  id: string;
  label: string;
  path: string;
}

export interface StudySectionOption {
  id: string;
  label: string;
  path: string;
  knowledgePointIds: string[];
}

export interface ActiveStudyContext {
  profile: Profile;
  scope: StudyScopeOption;
  material: string;
}

export type StudyTargetKind = "scope" | "card" | "section";

export interface ActiveStudyTargetContext extends ActiveStudyContext {
  target: {
    kind: StudyTargetKind;
    id: string;
    label: string;
    knowledgePointIds: string[];
  };
}

function parseKnowledgeIndex(raw: string): KnowledgeIndexRecord {
  const value = JSON.parse(raw) as Partial<KnowledgeIndexRecord>;
  if (typeof value.chapters !== "object" || value.chapters === null || Array.isArray(value.chapters)) {
    throw new Error("knowledge_index.json does not contain canonical chapters");
  }
  return value as KnowledgeIndexRecord;
}

export async function listStudyScopes(
  repository: ProfileFamilyRepository,
  subjectId: string,
): Promise<StudyScopeOption[]> {
  const profile = await repository.loadActiveProfile(subjectId);
  const index = parseKnowledgeIndex(await repository.readActiveFile(subjectId, profile.paths.knowledgeIndex));
  return Object.values(index.chapters).map((chapter) => {
    const knowledgePoints = chapter.knowledge_points ?? [];
    const sections = (chapter.sections ?? []).flatMap((section) => {
      if (typeof section.path !== "string") return [];
      return [{
        id: section.id,
        label: `${section.section} · ${section.title}`,
        path: section.path,
        knowledgePointIds: knowledgePoints
          .filter((point) => point.section === section.section)
          .map((point) => point.id),
      } satisfies StudySectionOption];
    });
    const cards = knowledgePoints.flatMap((point) => {
      if (!point.card_id) return [];
      return [{
        id: point.id,
        label: point.name,
        path: `${profile.paths.cards}/${point.card_id}.md`,
      } satisfies StudyCardOption];
    });
    const paths = new Set<string>();
    for (const section of sections) paths.add(section.path);
    for (const card of cards) paths.add(card.path);
    return {
      id: `chapter:${chapter.id}`,
      label: `第 ${chapter.id} 章 · ${chapter.title}`,
      chapterId: chapter.id,
      knowledgePointIds: knowledgePoints.map((point) => point.id),
      materialPaths: [...paths],
      cards,
      sections,
    };
  });
}

export async function loadActiveStudyTargetContext(
  repository: ProfileFamilyRepository,
  subjectId: string,
  scopeId: string,
  targetKind: StudyTargetKind,
  targetId: string,
  maxCharacters = 30_000,
): Promise<ActiveStudyTargetContext> {
  const profile = await repository.loadActiveProfile(subjectId);
  const scopes = await listStudyScopes(repository, subjectId);
  const scope = scopes.find((item) => item.id === scopeId);
  if (!scope) throw new Error(`Unknown study scope: ${scopeId}`);

  let target: ActiveStudyTargetContext["target"];
  let paths: string[];
  if (targetKind === "card") {
    const card = scope.cards.find((item) => item.id === targetId);
    if (!card) throw new Error(`Unknown study card: ${targetId}`);
    target = { kind: "card", id: card.id, label: card.label, knowledgePointIds: [card.id] };
    paths = [card.path];
  } else if (targetKind === "section") {
    const section = scope.sections.find((item) => item.id === targetId);
    if (!section) throw new Error(`Unknown study section: ${targetId}`);
    target = {
      kind: "section",
      id: section.id,
      label: section.label,
      knowledgePointIds: section.knowledgePointIds,
    };
    paths = [section.path];
  } else {
    target = {
      kind: "scope",
      id: scope.id,
      label: scope.label,
      knowledgePointIds: scope.knowledgePointIds,
    };
    paths = scope.materialPaths;
  }

  const chunks: string[] = [];
  if (targetKind === "scope") chunks.push(await repository.readActiveFile(subjectId, profile.paths.subject));
  for (const path of paths) {
    try {
      chunks.push(`\n\n--- 资料：${path} ---\n${await repository.readActiveFile(subjectId, path)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { profile, scope, target, material: chunks.join("").slice(0, maxCharacters) };
}

export async function loadActiveStudyContext(
  repository: ProfileFamilyRepository,
  subjectId: string,
  scopeId: string,
  maxCharacters = 30_000,
): Promise<ActiveStudyContext> {
  const context = await loadActiveStudyTargetContext(repository, subjectId, scopeId, "scope", scopeId, maxCharacters);
  return { profile: context.profile, scope: context.scope, material: context.material };
}
