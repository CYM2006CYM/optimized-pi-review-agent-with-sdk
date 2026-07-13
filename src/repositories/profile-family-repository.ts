import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import {
  CANONICAL_PROFILE_PATHS,
  parseProfileManifest,
  validateCanonicalProfileDirectory,
} from "../domain/profile-schema.js";
import type { Profile } from "../domain/types.js";
import {
  assertSafeRelativePath,
  assertSafeSubjectId,
  resolveInside,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from "../infrastructure/safe-files.js";

export interface ProfileFamilyRepositoryOptions {
  dataRoot?: string;
  fixturesRoot?: string;
  now?: () => Date;
}

export interface CreateDraftProfileInput {
  subjectId: string;
  name: string;
  subjectMarkdown?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class ProfileFamilyRepository {
  readonly dataRoot: string;
  readonly familiesRoot: string;
  readonly fixturesRoot: string;
  private readonly now: () => Date;

  constructor(options: ProfileFamilyRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.familiesRoot = profileFamiliesRoot(this.dataRoot);
    this.fixturesRoot = resolve(
      options.fixturesRoot ?? fileURLToPath(new URL("../../fixtures/profiles", import.meta.url)),
    );
    this.now = options.now ?? (() => new Date());
  }

  familyDirectory(subjectId: string): string {
    assertSafeSubjectId(subjectId);
    return resolveInside(this.familiesRoot, subjectId);
  }

  private slotDirectory(subjectId: string, slot: "active" | "draft"): string {
    return resolveInside(this.familyDirectory(subjectId), slot);
  }

  private async ensureFamilyScaffold(subjectId: string): Promise<void> {
    const family = this.familyDirectory(subjectId);
    await Promise.all([
      mkdir(resolveInside(family, "archived"), { recursive: true }),
      mkdir(resolveInside(family, "_user", "summaries", "pending"), { recursive: true }),
      mkdir(resolveInside(family, "_user", "summaries", "archived"), { recursive: true }),
    ]);
  }

  async seedDemoProfile(): Promise<Profile> {
    const subjectId = "demo-review";
    await this.ensureFamilyScaffold(subjectId);
    const active = this.slotDirectory(subjectId, "active");
    if (await pathExists(active)) {
      return validateCanonicalProfileDirectory(active, subjectId, "active");
    }
    if (await pathExists(this.slotDirectory(subjectId, "draft"))) {
      throw new Error("Cannot seed demo-review while an unconfirmed draft exists");
    }

    const fixture = resolveInside(this.fixturesRoot, subjectId);
    await validateCanonicalProfileDirectory(fixture, subjectId, "active");
    const temporary = resolveInside(this.familyDirectory(subjectId), `.active-seed-${crypto.randomUUID()}`);
    try {
      await cp(fixture, temporary, { recursive: true, errorOnExist: true });
      await validateCanonicalProfileDirectory(temporary, subjectId, "active");
      await rename(temporary, active);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return validateCanonicalProfileDirectory(active, subjectId, "active");
  }

  async listActiveProfiles(): Promise<Profile[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const families = await readdir(this.familiesRoot, { withFileTypes: true });
    const profiles: Profile[] = [];
    for (const family of families) {
      if (!family.isDirectory()) continue;
      try {
        assertSafeSubjectId(family.name);
      } catch {
        continue;
      }
      const active = this.slotDirectory(family.name, "active");
      if (await pathExists(active)) {
        profiles.push(await validateCanonicalProfileDirectory(active, family.name, "active"));
      }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async loadActiveProfile(subjectId: string): Promise<Profile> {
    return validateCanonicalProfileDirectory(this.slotDirectory(subjectId, "active"), subjectId, "active");
  }

  async loadDraftProfile(subjectId: string): Promise<Profile> {
    return validateCanonicalProfileDirectory(this.slotDirectory(subjectId, "draft"), subjectId, "draft");
  }

  /** active 只读出口；代码节点可读取资料，但仓库不提供 active 写入能力。 */
  async readActiveFile(subjectId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const active = this.slotDirectory(subjectId, "active");
    await this.loadActiveProfile(subjectId);
    return readFile(resolveInside(active, relativePath), "utf8");
  }

  async createDraftProfile(input: CreateDraftProfileInput): Promise<Profile> {
    assertSafeSubjectId(input.subjectId);
    if (input.name.trim() === "") throw new Error("Profile name must not be empty");
    await this.ensureFamilyScaffold(input.subjectId);
    const draft = this.slotDirectory(input.subjectId, "draft");
    if (await pathExists(draft)) throw new Error(`Draft already exists for ${input.subjectId}`);
    if (await pathExists(this.slotDirectory(input.subjectId, "active"))) {
      throw new Error(`Active Profile already exists for ${input.subjectId}; create a revision draft instead`);
    }

    const temporary = resolveInside(this.familyDirectory(input.subjectId), `.draft-create-${crypto.randomUUID()}`);
    const date = this.now();
    const manifest: Profile = {
      subjectId: input.subjectId,
      name: input.name.trim(),
      status: "draft",
      slot: "draft",
      version: timestampForPath(date),
      revision: 1,
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      paths: { ...CANONICAL_PROFILE_PATHS },
    };
    try {
      await Promise.all([
        mkdir(resolve(temporary, "cards"), { recursive: true }),
        mkdir(resolve(temporary, "chapters"), { recursive: true }),
        mkdir(resolve(temporary, "exam_points"), { recursive: true }),
      ]);
      await Promise.all([
        writeJsonAtomic(resolve(temporary, "profile.json"), manifest),
        writeTextAtomic(resolve(temporary, "subject.md"), input.subjectMarkdown ?? `# ${manifest.name}\n`),
        writeJsonAtomic(resolve(temporary, "knowledge_index.json"), { subject: manifest.name, chapters: {} }),
        writeJsonAtomic(resolve(temporary, "source_map.json"), { sources: [], mappings: {}, unmapped_sources: [], uncertain_mappings: {} }),
        writeTextAtomic(resolve(temporary, "quality_report.md"), `# ${manifest.name} 质量报告\n\n尚未生成资料内容。\n`),
      ]);
      await validateCanonicalProfileDirectory(temporary, input.subjectId, "draft");
      await rename(temporary, draft);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return this.loadDraftProfile(input.subjectId);
  }

  async createRevisionDraft(subjectId: string): Promise<Profile> {
    await this.ensureFamilyScaffold(subjectId);
    const draft = this.slotDirectory(subjectId, "draft");
    if (await pathExists(draft)) throw new Error(`Draft already exists for ${subjectId}`);
    const active = this.slotDirectory(subjectId, "active");
    const current = await validateCanonicalProfileDirectory(active, subjectId, "active");
    const temporary = resolveInside(this.familyDirectory(subjectId), `.draft-copy-${crypto.randomUUID()}`);
    try {
      await cp(active, temporary, { recursive: true, errorOnExist: true });
      const date = this.now();
      const revision: Profile = {
        ...current,
        status: "draft",
        slot: "draft",
        version: timestampForPath(date),
        revision: current.revision + 1,
        revisionOf: current.version,
        updatedAt: date.toISOString(),
        paths: { ...current.paths },
      };
      await writeJsonAtomic(resolve(temporary, "profile.json"), revision);
      await validateCanonicalProfileDirectory(temporary, subjectId, "draft");
      await rename(temporary, draft);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    return this.loadDraftProfile(subjectId);
  }

  async writeDraftFile(subjectId: string, relativePath: string, content: string): Promise<void> {
    assertSafeRelativePath(relativePath);
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    const normalized = relativePath.replaceAll("\\", "/");
    if (normalized === "profile.json") {
      parseProfileManifest(content, subjectId, "draft");
    }
    const target = resolveInside(draft, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeTextAtomic(target, content);
  }

  private async nextArchiveDirectory(subjectId: string): Promise<string> {
    const archived = resolveInside(this.familyDirectory(subjectId), "archived");
    await mkdir(archived, { recursive: true });
    const base = timestampForPath(this.now());
    for (let suffix = 0; ; suffix += 1) {
      const name = suffix === 0 ? base : `${base}-${suffix}`;
      const candidate = resolveInside(archived, name);
      if (!(await pathExists(candidate))) return candidate;
    }
  }

  async enableDraft(subjectId: string): Promise<Profile> {
    const draft = this.slotDirectory(subjectId, "draft");
    const active = this.slotDirectory(subjectId, "active");
    const currentDraft = await validateCanonicalProfileDirectory(draft, subjectId, "draft");
    const date = this.now();
    const activated: Profile = {
      ...currentDraft,
      status: "active",
      slot: "active",
      updatedAt: date.toISOString(),
      paths: { ...currentDraft.paths },
    };
    await writeJsonAtomic(resolve(draft, "profile.json"), activated);
    await validateCanonicalProfileDirectory(draft, subjectId, "active");

    let archive: string | undefined;
    try {
      if (await pathExists(active)) {
        await validateCanonicalProfileDirectory(active, subjectId, "active");
        archive = await this.nextArchiveDirectory(subjectId);
        await rename(active, archive);
      }
      await rename(draft, active);
    } catch (error) {
      const restoredDraft: Profile = { ...activated, status: "draft", slot: "draft" };
      if (await pathExists(draft)) await writeJsonAtomic(resolve(draft, "profile.json"), restoredDraft);
      if (archive !== undefined && !(await pathExists(active)) && (await pathExists(archive))) {
        await rename(archive, active);
      }
      throw error;
    }
    return validateCanonicalProfileDirectory(active, subjectId, "active");
  }

  async discardDraft(subjectId: string): Promise<void> {
    const draft = this.slotDirectory(subjectId, "draft");
    if (!(await pathExists(draft))) throw new Error(`No draft exists for ${subjectId}`);
    await rm(draft, { recursive: true });
  }
}
