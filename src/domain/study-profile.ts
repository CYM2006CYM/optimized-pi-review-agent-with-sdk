import type { Profile } from "./types.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

interface KnowledgePointRecord {
  id: string;
  name: string;
  card_id?: string;
}

interface ChapterRecord {
  id: string;
  title: string;
  sections?: Array<{ path?: string }>;
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
}

export interface ActiveStudyContext {
  profile: Profile;
  scope: StudyScopeOption;
  material: string;
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
    const paths = new Set<string>();
    for (const section of chapter.sections ?? []) {
      if (typeof section.path === "string") paths.add(section.path);
    }
    for (const point of knowledgePoints) {
      if (point.card_id) paths.add(`${profile.paths.cards}/${point.card_id}.md`);
    }
    return {
      id: `chapter:${chapter.id}`,
      label: `第 ${chapter.id} 章 · ${chapter.title}`,
      chapterId: chapter.id,
      knowledgePointIds: knowledgePoints.map((point) => point.id),
      materialPaths: [...paths],
    };
  });
}

export async function loadActiveStudyContext(
  repository: ProfileFamilyRepository,
  subjectId: string,
  scopeId: string,
  maxCharacters = 30_000,
): Promise<ActiveStudyContext> {
  const profile = await repository.loadActiveProfile(subjectId);
  const scopes = await listStudyScopes(repository, subjectId);
  const scope = scopes.find((item) => item.id === scopeId);
  if (!scope) throw new Error(`Unknown study scope: ${scopeId}`);
  const chunks = [await repository.readActiveFile(subjectId, profile.paths.subject)];
  for (const path of scope.materialPaths) {
    try {
      chunks.push(`\n\n--- 资料：${path} ---\n${await repository.readActiveFile(subjectId, path)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { profile, scope, material: chunks.join("").slice(0, maxCharacters) };
}
