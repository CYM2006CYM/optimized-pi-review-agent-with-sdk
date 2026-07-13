import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { profileFamiliesRoot, resolveStudyDataRoot } from "../config/data-paths.js";
import type {
  Attempt,
  LearningProfile,
  LearningRecordBatch,
  StudySession,
} from "../domain/types.js";
import {
  assertSafeFileComponent,
  assertSafeSubjectId,
  resolveInside,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from "../infrastructure/safe-files.js";

export interface PrivateMemoryRepositoryOptions {
  dataRoot?: string;
  now?: () => Date;
  /** @internal 测试归档事务回滚；生产默认使用 node:fs rename。 */
  renamePath?: (from: string, to: string) => Promise<void>;
}

export interface PendingLearningRecordBatch extends LearningRecordBatch {
  session: StudySession;
  attempts: Attempt[];
  summaryMarkdown?: string;
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

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function validateLearningProfile(profile: LearningProfile, subjectId: string): void {
  if (profile.subject_id !== subjectId) throw new Error(`Learning Profile subject_id must be ${subjectId}`);
  if (!Number.isFinite(profile.total_questions) || profile.total_questions < 0) {
    throw new Error("Learning Profile total_questions must be non-negative");
  }
  if (!Number.isFinite(profile.total_correct) || profile.total_correct < 0) {
    throw new Error("Learning Profile total_correct must be non-negative");
  }
  if (!Number.isFinite(profile.accuracy) || profile.accuracy < 0 || profile.accuracy > 1) {
    throw new Error("Learning Profile accuracy must be between 0 and 1");
  }
  for (const [name, value] of Object.entries({
    weak_points: profile.weak_points,
    strengths: profile.strengths,
    unverified_topics: profile.unverified_topics,
    recommendations: profile.recommendations,
    recent_sessions: profile.recent_sessions,
  })) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`Learning Profile ${name} must be a string array`);
    }
  }
  if (typeof profile.profile_summary !== "string" || profile.profile_summary.trim() === "") {
    throw new Error("Learning Profile profile_summary must be non-empty");
  }
  if (Number.isNaN(Date.parse(profile.updated_at))) {
    throw new Error("Learning Profile updated_at must be an ISO date");
  }
}

export class PrivateMemoryRepository {
  readonly dataRoot: string;
  readonly familiesRoot: string;
  private readonly now: () => Date;
  private readonly renamePath: (from: string, to: string) => Promise<void>;

  constructor(options: PrivateMemoryRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.familiesRoot = profileFamiliesRoot(this.dataRoot);
    this.now = options.now ?? (() => new Date());
    this.renamePath = options.renamePath ?? rename;
  }

  private userDirectory(subjectId: string): string {
    assertSafeSubjectId(subjectId);
    return resolveInside(this.familiesRoot, subjectId, "_user");
  }

  private pendingDirectory(subjectId: string): string {
    return resolveInside(this.userDirectory(subjectId), "summaries", "pending");
  }

  private archivedDirectory(subjectId: string): string {
    return resolveInside(this.userDirectory(subjectId), "summaries", "archived");
  }

  private batchDirectory(subjectId: string, batchId: string): string {
    assertSafeFileComponent(batchId, "batchId");
    return resolveInside(this.pendingDirectory(subjectId), batchId);
  }

  async createPendingBatch(session: StudySession): Promise<LearningRecordBatch> {
    assertSafeSubjectId(session.subjectId);
    assertSafeFileComponent(session.sessionId, "sessionId");
    if (session.status !== "running") throw new Error("A new learning record batch must start with a running session");
    const batchId = `${timestampForPath(this.now())}_${session.sessionId}`;
    const directory = this.batchDirectory(session.subjectId, batchId);
    if (await pathExists(directory)) throw new Error(`Learning record batch already exists: ${batchId}`);
    await mkdir(resolve(directory, "attempts"), { recursive: true });
    await writeJsonAtomic(resolve(directory, "session.json"), session);
    return { batchId, subjectId: session.subjectId, sessionId: session.sessionId, directory };
  }

  async saveAttempt(subjectId: string, batchId: string, attempt: Attempt): Promise<void> {
    assertSafeFileComponent(attempt.question_id, "question_id");
    const batch = await this.loadPendingBatch(subjectId, batchId);
    if (batch.session.status !== "running") throw new Error("Cannot add an attempt to a finished session");
    if (attempt.session_id !== batch.session.sessionId) throw new Error("Attempt session_id does not match its batch");
    await writeJsonAtomic(resolve(batch.directory, "attempts", `${attempt.question_id}.json`), attempt);
  }

  async saveRunningSession(subjectId: string, batchId: string, runningSession: StudySession): Promise<void> {
    const batch = await this.loadPendingBatch(subjectId, batchId);
    if (runningSession.sessionId !== batch.session.sessionId || runningSession.subjectId !== subjectId) {
      throw new Error("Running session does not match its learning record batch");
    }
    if (runningSession.status !== "running") throw new Error("Progress updates require running status");
    await writeJsonAtomic(resolve(batch.directory, "session.json"), runningSession);
  }

  async completeSession(
    subjectId: string,
    batchId: string,
    completedSession: StudySession,
    summaryMarkdown: string,
  ): Promise<void> {
    const batch = await this.loadPendingBatch(subjectId, batchId);
    if (completedSession.sessionId !== batch.session.sessionId || completedSession.subjectId !== subjectId) {
      throw new Error("Completed session does not match its learning record batch");
    }
    if (completedSession.status !== "completed") throw new Error("Normal completion must use completed status");
    if (summaryMarkdown.trim() === "") throw new Error("Normal completion requires a non-empty learning summary");
    const summaryPath = resolve(batch.directory, "summary.md");
    await writeTextAtomic(summaryPath, summaryMarkdown);
    try {
      await writeJsonAtomic(resolve(batch.directory, "session.json"), completedSession);
    } catch (error) {
      if (batch.summaryMarkdown === undefined) await rm(summaryPath, { force: true });
      else await writeTextAtomic(summaryPath, batch.summaryMarkdown);
      throw error;
    }
  }

  async interruptSession(subjectId: string, batchId: string, interruptedSession: StudySession): Promise<void> {
    const batch = await this.loadPendingBatch(subjectId, batchId);
    if (interruptedSession.sessionId !== batch.session.sessionId || interruptedSession.subjectId !== subjectId) {
      throw new Error("Interrupted session does not match its learning record batch");
    }
    if (interruptedSession.status !== "interrupted") throw new Error("Interrupted session must use interrupted status");
    await writeJsonAtomic(resolve(batch.directory, "session.json"), interruptedSession);
  }

  async loadPendingBatch(subjectId: string, batchId: string): Promise<PendingLearningRecordBatch> {
    const directory = this.batchDirectory(subjectId, batchId);
    const session = parseJson<StudySession>(await readFile(resolve(directory, "session.json"), "utf8"), "session.json");
    if (session.subjectId !== subjectId) throw new Error("Learning record batch belongs to another subject");
    const attemptEntries = await readdir(resolve(directory, "attempts"), { withFileTypes: true });
    const attempts: Attempt[] = [];
    for (const entry of attemptEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      attempts.push(parseJson<Attempt>(await readFile(resolve(directory, "attempts", entry.name), "utf8"), entry.name));
    }
    let summaryMarkdown: string | undefined;
    try {
      summaryMarkdown = await readFile(resolve(directory, "summary.md"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return {
      batchId,
      subjectId,
      sessionId: session.sessionId,
      directory,
      session,
      attempts,
      summaryMarkdown,
    };
  }

  async listPendingBatches(subjectId: string): Promise<PendingLearningRecordBatch[]> {
    const pending = this.pendingDirectory(subjectId);
    await mkdir(pending, { recursive: true });
    const entries = await readdir(pending, { withFileTypes: true });
    const batches: PendingLearningRecordBatch[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) batches.push(await this.loadPendingBatch(subjectId, entry.name));
    }
    return batches;
  }

  async loadLearningProfile(subjectId: string): Promise<LearningProfile | null> {
    const path = resolveInside(this.userDirectory(subjectId), "learning_profile.json");
    try {
      return parseJson<LearningProfile>(await readFile(path, "utf8"), "learning_profile.json");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async uniqueArchivedBatchPath(subjectId: string, batchId: string): Promise<string> {
    const archived = this.archivedDirectory(subjectId);
    await mkdir(archived, { recursive: true });
    for (let suffix = 0; ; suffix += 1) {
      const name = suffix === 0 ? batchId : `${batchId}-${suffix}`;
      const candidate = resolveInside(archived, name);
      if (!(await pathExists(candidate))) return candidate;
    }
  }

  /** 写入画像成功后才消费批次；任一移动失败时恢复画像与已移动批次。 */
  async saveLearningProfileAndArchive(
    subjectId: string,
    profile: LearningProfile,
    batchIds: string[],
  ): Promise<void> {
    assertSafeSubjectId(subjectId);
    validateLearningProfile(profile, subjectId);
    if (batchIds.length === 0) throw new Error("At least one pending batch must be selected");
    if (new Set(batchIds).size !== batchIds.length) throw new Error("Duplicate batchIds are not allowed");

    const batches = await Promise.all(batchIds.map((batchId) => this.loadPendingBatch(subjectId, batchId)));
    for (const batch of batches) {
      if (batch.session.status === "running") throw new Error(`Cannot consume running batch: ${batch.batchId}`);
    }

    const profilePath = resolveInside(this.userDirectory(subjectId), "learning_profile.json");
    let previousProfile: string | undefined;
    try {
      previousProfile = await readFile(profilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await writeJsonAtomic(profilePath, profile);
    const moved: Array<{ from: string; to: string }> = [];
    try {
      for (const batch of batches) {
        const destination = await this.uniqueArchivedBatchPath(subjectId, batch.batchId);
        await this.renamePath(batch.directory, destination);
        moved.push({ from: batch.directory, to: destination });
      }
    } catch (error) {
      for (const item of moved.reverse()) {
        if (await pathExists(item.to)) await this.renamePath(item.to, item.from);
      }
      if (previousProfile === undefined) await rm(profilePath, { force: true });
      else await writeTextAtomic(profilePath, previousProfile);
      throw error;
    }
  }
}
