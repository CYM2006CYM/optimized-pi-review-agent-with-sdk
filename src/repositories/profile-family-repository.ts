import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import {
  CANONICAL_PROFILE_PATHS,
  parseProfileManifest,
  validateCanonicalProfileDirectory,
} from "../domain/profile-schema.js";
import type { Profile } from "../domain/types.js";
import type { ProfileRevisionChange, ProfileFileSnapshot } from "../domain/profile-revision.js";
import { isMutableProfileContentPath } from "../domain/profile-revision.js";
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

export interface ProfileRevisionCandidate {
  subjectId: string;
  name: string;
  hasActive: boolean;
  hasDraft: boolean;
  activeRevision?: number;
  draftRevision?: number;
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

  async listRevisionCandidates(): Promise<ProfileRevisionCandidate[]> {
    await mkdir(this.familiesRoot, { recursive: true });
    const families = await readdir(this.familiesRoot, { withFileTypes: true });
    const candidates: ProfileRevisionCandidate[] = [];
    for (const family of families) {
      if (!family.isDirectory()) continue;
      try {
        assertSafeSubjectId(family.name);
      } catch {
        continue;
      }
      let active: Profile | undefined;
      let draft: Profile | undefined;
      try { active = await this.loadActiveProfile(family.name); } catch { /* candidate may be draft-only */ }
      try { draft = await this.loadDraftProfile(family.name); } catch { /* candidate may be active-only */ }
      if (!active && !draft) continue;
      candidates.push({
        subjectId: family.name,
        name: draft?.name ?? active!.name,
        hasActive: active !== undefined,
        hasDraft: draft !== undefined,
        activeRevision: active?.revision,
        draftRevision: draft?.revision,
      });
    }
    return candidates.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
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

  async readDraftFile(subjectId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    return readFile(resolveInside(draft, relativePath), "utf8");
  }

  async listDraftFiles(subjectId: string): Promise<ProfileFileSnapshot[]> {
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    const files: ProfileFileSnapshot[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Profile draft: ${entry.name}`);
        const absolute = resolveInside(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && /\.(md|json)$/iu.test(entry.name)) {
          const relativePath = relative(draft, absolute).replaceAll("\\", "/");
          assertSafeRelativePath(relativePath);
          files.push({ path: relativePath, content: await readFile(absolute, "utf8") });
        }
      }
    };
    await visit(draft);
    return files;
  }

  async listActiveFiles(subjectId: string): Promise<ProfileFileSnapshot[]> {
    const active = this.slotDirectory(subjectId, "active");
    await this.loadActiveProfile(subjectId);
    const files: ProfileFileSnapshot[] = [];
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
        if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in active Profile: ${entry.name}`);
        const absolute = resolveInside(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && /\.(md|json)$/iu.test(entry.name)) {
          const relativePath = relative(active, absolute).replaceAll("\\", "/");
          assertSafeRelativePath(relativePath);
          files.push({ path: relativePath, content: await readFile(absolute, "utf8") });
        }
      }
    };
    await visit(active);
    return files;
  }

  async applyDraftChanges(subjectId: string, changes: readonly ProfileRevisionChange[]): Promise<Profile> {
    if (changes.length === 0) throw new Error("Profile revision requires at least one change");
    const draft = this.slotDirectory(subjectId, "draft");
    await this.loadDraftProfile(subjectId);
    await this.listDraftFiles(subjectId);
    const seen = new Set<string>();
    for (const change of changes) {
      const path = change.path.replaceAll("\\", "/");
      assertSafeRelativePath(path);
      if (!isMutableProfileContentPath(path) && path !== "quality_report.md") {
        throw new Error(`Profile revision path is not writable: ${path}`);
      }
      if (change.operation === "delete" && ["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"].includes(path)) {
        throw new Error(`Required Profile file cannot be deleted: ${path}`);
      }
      if (seen.has(path)) throw new Error(`Duplicate Profile revision path: ${path}`);
      seen.add(path);
      if (change.operation !== "delete" && typeof change.content !== "string") {
        throw new Error(`Profile revision content is required: ${path}`);
      }
    }

    const family = this.familyDirectory(subjectId);
    const temporary = resolveInside(family, `.draft-update-${crypto.randomUUID()}`);
    const backup = resolveInside(family, `.draft-backup-${crypto.randomUUID()}`);
    try {
      await cp(draft, temporary, { recursive: true, errorOnExist: true });
      for (const change of changes) {
        const target = resolveInside(temporary, change.path);
        if (change.operation === "delete") await rm(target, { force: true });
        else await writeTextAtomic(target, change.content!);
      }
      const manifest = parseProfileManifest(await readFile(resolve(temporary, "profile.json"), "utf8"), subjectId, "draft");
      await writeJsonAtomic(resolve(temporary, "profile.json"), {
        ...manifest,
        updatedAt: this.now().toISOString(),
      });
      await validateCanonicalProfileDirectory(temporary, subjectId, "draft");
      await rename(draft, backup);
      try {
        await rename(temporary, draft);
      } catch (error) {
        await rename(backup, draft);
        throw error;
      }
      await rm(backup, { recursive: true, force: true }).catch(() => undefined);
      return this.loadDraftProfile(subjectId);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (await pathExists(backup)) {
        if (!(await pathExists(draft))) await rename(backup, draft);
        else await rm(backup, { recursive: true, force: true });
      }
      throw error;
    }
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
    await this.listDraftFiles(subjectId);
    const activeExists = await pathExists(active);
    let currentActive: Profile | undefined;
    if (activeExists) currentActive = await validateCanonicalProfileDirectory(active, subjectId, "active");
    if (currentDraft.revisionOf !== undefined) {
      if (!currentActive) throw new Error("Revision draft cannot be enabled because its active source is missing");
      if (currentDraft.revisionOf !== currentActive.version) {
        throw new Error(`Revision draft is stale: expected active ${currentDraft.revisionOf}, found ${currentActive.version}`);
      }
    } else if (currentActive) {
      throw new Error("A new Profile draft cannot replace an existing active Profile without revisionOf");
    }

    const date = this.now();
    const activated: Profile = {
      ...currentDraft,
      status: "active",
      slot: "active",
      updatedAt: date.toISOString(),
      paths: { ...currentDraft.paths },
    };
    const family = this.familyDirectory(subjectId);
    const prepared = resolveInside(family, `.active-enable-${crypto.randomUUID()}`);
    const draftBackup = resolveInside(family, `.draft-enable-backup-${crypto.randomUUID()}`);
    let archive: string | undefined;
    try {
      await cp(draft, prepared, { recursive: true, errorOnExist: true });
      await writeJsonAtomic(resolve(prepared, "profile.json"), activated);
      await validateCanonicalProfileDirectory(prepared, subjectId, "active");
      if (currentActive) {
        archive = await this.nextArchiveDirectory(subjectId);
        await rename(active, archive);
      }
      await rename(draft, draftBackup);
      try {
        await rename(prepared, active);
      } catch (error) {
        await rename(draftBackup, draft);
        if (archive !== undefined && !(await pathExists(active)) && (await pathExists(archive))) {
          await rename(archive, active);
        }
        throw error;
      }
      await rm(draftBackup, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      await rm(prepared, { recursive: true, force: true });
      if (await pathExists(draftBackup) && !(await pathExists(draft))) await rename(draftBackup, draft);
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
