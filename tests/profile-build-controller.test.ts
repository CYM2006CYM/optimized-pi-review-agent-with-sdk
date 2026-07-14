import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { GraphRunResult } from "pi-loop-graph-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileBuildController } from "../src/application/profile-build-controller.js";
import type { StudyControllerUi } from "../src/application/study-session-controller.js";
import type { IsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";
import { createStudyWalkingSkeletonGraphs } from "../src/graphs/study-walking-skeleton.js";
import { ProfileBuildJobRepository } from "../src/repositories/profile-build-job-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

class BuildUi implements StudyControllerUi {
  readonly notifications: Array<{ message: string; level?: string }> = [];
  constructor(readonly selections: Array<string | undefined>, readonly inputs: Array<string | undefined>) {}
  setWidget(): void {}
  async input(): Promise<string | undefined> { return this.inputs.shift(); }
  async select(_title: string, options: string[]): Promise<string | undefined> {
    const next = this.selections.shift();
    return next === "__FIRST__" ? options[0] : next;
  }
  notify(message: string, level?: "info" | "warning" | "error"): void { this.notifications.push({ message, level }); }
  setStatus(): void {}
}

describe("ProfileBuildController", () => {
  let dataRoot: string;
  let sourceRoot: string;
  let profiles: ProfileFamilyRepository;
  let jobs: ProfileBuildJobRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-profile-build-controller-"));
    sourceRoot = await mkdtemp(resolve(tmpdir(), "pi-profile-build-sources-"));
    await writeFile(resolve(sourceRoot, "notes.md"), "# 记忆方法\n\n主动回忆是在看答案前先尝试提取知识。\n", "utf8");
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
      now: () => new Date("2026-07-14T10:00:00.000Z"),
    });
    jobs = new ProfileBuildJobRepository({
      dataRoot,
      now: () => new Date("2026-07-14T10:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
  });

  function controller(options: { ui: BuildUi; fail?: boolean }) {
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    const executeGraph: IsolatedGraphExecutor = async (graph, params): Promise<GraphRunResult> => {
      if (options.fail) return { graphId: graph.id, status: "failed", result: { reason: "model unavailable" }, steps: 1 };
      const sourceId = (params.allowedSourceIds as string[])[0]!;
      return {
        graphId: graph.id,
        status: "ok",
        steps: 1,
        result: {
          subject_overview: "本资料介绍主动回忆。",
          warnings: [],
          chapters: [{
            title: "记忆方法",
            source_ids: [sourceId],
            sections: [{
              title: "主动回忆",
              markdown: "主动回忆是在看答案前先尝试提取知识。",
              source_ids: [sourceId],
              knowledge_points: [{
                id: "active-recall",
                name: "主动回忆",
                aliases: ["检索练习"],
                tags: ["记忆"],
                definition: "先尝试从记忆中提取知识。",
                key_points: ["先提取再查看"],
                common_misconceptions: ["重复阅读等于掌握"],
                related: [],
                question_types: ["short_answer"],
                difficulty_baseline: "S-U",
                source_ids: [sourceId],
              }],
            }],
          }],
        },
      };
    };
    return new ProfileBuildController({ profiles, jobs, graphs, executeGraph, ui: options.ui });
  }

  it("从源目录生成 canonical draft 并确认启用", async () => {
    const ui = new BuildUi(["确认启用为 active"], ["memory", "记忆方法"]);

    const result = await controller({ ui }).run(sourceRoot);

    expect(result).toMatchObject({ status: "enabled", subjectId: "memory" });
    const active = await profiles.loadActiveProfile("memory");
    expect(active.status).toBe("active");
    expect(await profiles.readActiveFile("memory", "cards/active-recall.md")).toContain("主动回忆");
    expect(JSON.parse(await profiles.readActiveFile("memory", "knowledge_index.json")).chapters["1"])
      .toMatchObject({ title: "记忆方法" });
    expect((await jobs.listJobs())[0]?.status).toBe("enabled");
  });

  it("用户可以保留 draft 而不启用", async () => {
    const ui = new BuildUi(["保留 draft，稍后处理"], ["memory", "记忆方法"]);

    await expect(controller({ ui }).run(sourceRoot)).resolves.toMatchObject({ status: "kept_draft" });
    expect((await profiles.loadDraftProfile("memory")).status).toBe("draft");
    await expect(profiles.loadActiveProfile("memory")).rejects.toBeDefined();
  });

  it("Agent 失败后保留 checkpoint，重新执行可从该批次继续", async () => {
    const firstUi = new BuildUi([], ["memory", "记忆方法"]);
    const failed = await controller({ ui: firstUi, fail: true }).run(sourceRoot);
    expect(failed).toMatchObject({ status: "failed" });
    const [failedJob] = await jobs.listUnfinishedJobs();
    expect(failedJob).toMatchObject({ status: "failed", nextBatchIndex: 0 });
    await expect(stat(resolve(dataRoot, "profile_families", "memory", "draft"))).resolves.toBeDefined();

    const resumeUi = new BuildUi(["__FIRST__", "确认启用为 active"], []);
    const resumed = await controller({ ui: resumeUi }).run("");

    expect(resumed).toMatchObject({ status: "enabled", jobId: failedJob?.jobId });
    expect((await jobs.loadJob(failedJob!.jobId)).nextBatchIndex).toBe(1);
    expect((await profiles.loadActiveProfile("memory")).status).toBe("active");
  });

  it("用户放弃时删除 draft 但不修改源资料", async () => {
    const ui = new BuildUi(["放弃并删除 draft"], ["memory", "记忆方法"]);

    await expect(controller({ ui }).run(sourceRoot)).resolves.toMatchObject({ status: "discarded" });
    await expect(profiles.loadDraftProfile("memory")).rejects.toBeDefined();
    expect(await stat(resolve(sourceRoot, "notes.md"))).toBeDefined();
  });
});
