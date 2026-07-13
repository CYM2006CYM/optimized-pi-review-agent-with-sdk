import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileBuildFragment } from "../src/domain/profile-build.js";
import type { SourceBatch, SourceInventory } from "../src/domain/source-inventory.js";
import { ProfileBuildJobRepository } from "../src/repositories/profile-build-job-repository.js";

const inventory: SourceInventory = {
  root: "C:\\sources",
  totalBytes: 10,
  totalCharacters: 10,
  files: [{ sourceId: "src-1", relativePath: "a.md", sha256: "a".repeat(64), bytes: 10, characters: 10 }],
};
const batches: SourceBatch[] = [{ index: 0, files: inventory.files, characters: 10 }];
const fragment: ProfileBuildFragment = {
  subject_overview: "概述",
  warnings: [],
  chapters: [{ title: "第一章", source_ids: ["src-1"], sections: [{
    title: "第一节",
    markdown: "正文",
    source_ids: ["src-1"],
    knowledge_points: [],
  }] }],
};

describe("ProfileBuildJobRepository", () => {
  let dataRoot: string;
  let repository: ProfileBuildJobRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-profile-job-"));
    repository = new ProfileBuildJobRepository({
      dataRoot,
      now: () => new Date("2026-07-14T10:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("逐批保存 fragment 并推进 checkpoint", async () => {
    const job = await repository.createJob({ subjectId: "math", subjectName: "数学", inventory, batches });
    expect(job.nextBatchIndex).toBe(0);

    const updated = await repository.saveFragment(job.jobId, 0, fragment);

    expect(updated.nextBatchIndex).toBe(1);
    expect(await repository.loadFragments(job.jobId)).toEqual([fragment]);
  });

  it("failed job 仍可被列出并恢复为 extracting", async () => {
    const job = await repository.createJob({ subjectId: "math", subjectName: "数学", inventory, batches });
    await repository.setStatus(job.jobId, "failed", "network");
    expect((await repository.listUnfinishedJobs()).map((item) => item.jobId)).toEqual([job.jobId]);

    const resumed = await repository.setStatus(job.jobId, "extracting");
    expect(resumed.status).toBe("extracting");
    expect(resumed.error).toBeUndefined();
  });

  it("同一 subject 不允许创建第二个未完成 job", async () => {
    await repository.createJob({ subjectId: "math", subjectName: "数学", inventory, batches });
    await expect(repository.createJob({ subjectId: "math", subjectName: "数学", inventory, batches }))
      .rejects.toThrow("Unfinished Profile build job");
  });
});
