import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProfileBuildFragment } from "../domain/profile-build.js";
import type { SourceBatch, SourceInventory } from "../domain/source-inventory.js";
import { resolveStudyDataRoot } from "../config/data-paths.js";
import {
  assertSafeFileComponent,
  assertSafeSubjectId,
  resolveInside,
  timestampForPath,
  writeJsonAtomic,
} from "../infrastructure/safe-files.js";

export type ProfileBuildJobStatus = "extracting" | "draft_ready" | "enabled" | "kept_draft" | "discarded" | "failed";

export interface ProfileBuildJob {
  jobId: string;
  subjectId: string;
  subjectName: string;
  sourceRoot: string;
  inventory: SourceInventory;
  batches: SourceBatch[];
  nextBatchIndex: number;
  status: ProfileBuildJobStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ProfileBuildJobRepositoryOptions {
  dataRoot?: string;
  now?: () => Date;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export class ProfileBuildJobRepository {
  readonly dataRoot: string;
  readonly jobsRoot: string;
  private readonly now: () => Date;

  constructor(options: ProfileBuildJobRepositoryOptions = {}) {
    this.dataRoot = resolveStudyDataRoot(options.dataRoot);
    this.jobsRoot = resolve(this.dataRoot, "profile_build_jobs");
    this.now = options.now ?? (() => new Date());
  }

  private jobDirectory(jobId: string): string {
    assertSafeFileComponent(jobId, "jobId");
    return resolveInside(this.jobsRoot, jobId);
  }

  async createJob(input: {
    subjectId: string;
    subjectName: string;
    inventory: SourceInventory;
    batches: SourceBatch[];
  }): Promise<ProfileBuildJob> {
    assertSafeSubjectId(input.subjectId);
    if (input.subjectName.trim() === "") throw new Error("Profile subject name must not be empty");
    if (input.batches.length === 0) throw new Error("Profile build job requires source batches");
    const unfinished = (await this.listJobs()).find((job) => job.subjectId === input.subjectId
      && ["extracting", "draft_ready", "failed"].includes(job.status));
    if (unfinished) throw new Error(`Unfinished Profile build job already exists: ${unfinished.jobId}`);
    const now = this.now();
    const jobId = `${timestampForPath(now)}_${input.subjectId}_${crypto.randomUUID().slice(0, 8)}`;
    const directory = this.jobDirectory(jobId);
    await mkdir(resolve(directory, "fragments"), { recursive: true });
    const job: ProfileBuildJob = {
      jobId,
      subjectId: input.subjectId,
      subjectName: input.subjectName.trim(),
      sourceRoot: input.inventory.root,
      inventory: input.inventory,
      batches: input.batches,
      nextBatchIndex: 0,
      status: "extracting",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await writeJsonAtomic(resolve(directory, "job.json"), job);
    return job;
  }

  async loadJob(jobId: string): Promise<ProfileBuildJob> {
    return parseJson<ProfileBuildJob>(
      await readFile(resolve(this.jobDirectory(jobId), "job.json"), "utf8"),
      "profile build job",
    );
  }

  async listJobs(): Promise<ProfileBuildJob[]> {
    await mkdir(this.jobsRoot, { recursive: true });
    const entries = await readdir(this.jobsRoot, { withFileTypes: true });
    const jobs: ProfileBuildJob[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      try {
        jobs.push(await this.loadJob(entry.name));
      } catch {
        // 损坏 job 由显式 doctor 处理，不阻断其他构建任务。
      }
    }
    return jobs;
  }

  async listUnfinishedJobs(): Promise<ProfileBuildJob[]> {
    return (await this.listJobs()).filter((job) => ["extracting", "draft_ready", "failed"].includes(job.status));
  }

  async saveFragment(jobId: string, batchIndex: number, fragment: ProfileBuildFragment): Promise<ProfileBuildJob> {
    const job = await this.loadJob(jobId);
    if (job.status !== "extracting") throw new Error("Profile build job is not extracting");
    if (batchIndex !== job.nextBatchIndex) throw new Error(`Expected batch ${job.nextBatchIndex}, received ${batchIndex}`);
    await writeJsonAtomic(
      resolve(this.jobDirectory(jobId), "fragments", `${String(batchIndex).padStart(4, "0")}.json`),
      fragment,
    );
    return this.updateJob({
      ...job,
      nextBatchIndex: batchIndex + 1,
      updatedAt: this.now().toISOString(),
    });
  }

  async loadFragments(jobId: string): Promise<ProfileBuildFragment[]> {
    const directory = resolve(this.jobDirectory(jobId), "fragments");
    const entries = await readdir(directory, { withFileTypes: true });
    const fragments: ProfileBuildFragment[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      fragments.push(parseJson<ProfileBuildFragment>(await readFile(resolve(directory, entry.name), "utf8"), entry.name));
    }
    return fragments;
  }

  async setStatus(jobId: string, status: ProfileBuildJobStatus, error?: string): Promise<ProfileBuildJob> {
    const job = await this.loadJob(jobId);
    const updated: ProfileBuildJob = {
      ...job,
      status,
      updatedAt: this.now().toISOString(),
    };
    if (error === undefined) delete updated.error;
    else updated.error = error;
    return this.updateJob(updated);
  }

  private async updateJob(job: ProfileBuildJob): Promise<ProfileBuildJob> {
    await writeJsonAtomic(resolve(this.jobDirectory(job.jobId), "job.json"), job);
    return job;
  }
}
