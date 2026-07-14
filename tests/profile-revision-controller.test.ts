import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { GraphRunResult } from "pi-loop-graph-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileRevisionController } from "../src/application/profile-revision-controller.js";
import type { StudyControllerUi } from "../src/application/study-session-controller.js";
import type { IsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";
import { createStudyWalkingSkeletonGraphs } from "../src/graphs/study-walking-skeleton.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

class RevisionUi implements StudyControllerUi {
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

describe("ProfileRevisionController", () => {
  let dataRoot: string;
  let profiles: ProfileFamilyRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-profile-revision-controller-"));
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    });
    await profiles.seedDemoProfile();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function controller(ui: RevisionUi, options: { blocking?: boolean; failAt?: string; clarifyOnce?: boolean; patchContent?: string } = {}) {
    const graphs = createStudyWalkingSkeletonGraphs(profiles);
    let planCalls = 0;
    const executeGraph: IsolatedGraphExecutor = async (graph): Promise<GraphRunResult> => {
      if (options.failAt === graph.id) {
        return { graphId: graph.id, status: "failed", result: { reason: "model unavailable" }, steps: 1 };
      }
      if (graph.id === "study_plan_profile_revision") {
        planCalls += 1;
        if (options.clarifyOnce && planCalls === 1) {
          return {
            graphId: graph.id,
            status: "ok",
            steps: 1,
            result: {
              summary: "需要明确修改目标",
              requires_clarification: true,
              clarification_question: "请明确要修改哪一部分？",
              operations: [],
              warnings: [],
            },
          };
        }
        return {
          graphId: graph.id,
          status: "ok",
          steps: 1,
          result: {
            summary: "更新科目说明",
            requires_clarification: false,
            clarification_question: "",
            operations: [{ path: "subject.md", operation: "update", reason: "按用户反馈补充" }],
            warnings: [],
          },
        };
      }
      if (graph.id === "study_revise_profile_draft") {
        return {
          graphId: graph.id,
          status: "ok",
          steps: 1,
          result: {
            summary: "科目说明已更新",
            changes: [{ path: "subject.md", operation: "update", reason: "按用户反馈补充", content: options.patchContent ?? "# 已修订的学习方法\n" }],
            unresolved: [],
          },
        };
      }
      return {
        graphId: graph.id,
        status: "ok",
        steps: 1,
        result: {
          report_markdown: "# 修订质量报告\n\n已检查本轮变更。",
          blocking_issues: options.blocking ? ["语义仍需确认"] : [],
          warnings: [],
          recommendation: options.blocking ? "revise" : "enable",
        },
      };
    };
    return new ProfileRevisionController({ profiles, graphs, executeGraph, ui });
  }

  it("从 active 创建 draft、修订并确认启用归档旧版本", async () => {
    const oldVersion = (await profiles.loadActiveProfile("demo-review")).version;
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "确认启用为 active"], ["修订科目说明"]);

    await expect(controller(ui).run("demo-review")).resolves.toEqual({ status: "enabled", subjectId: "demo-review" });
    expect(await profiles.readActiveFile("demo-review", "subject.md")).toBe("# 已修订的学习方法\n");
    expect((await profiles.loadActiveProfile("demo-review")).revision).toBe(2);
    const archives = await readdir(resolve(profiles.familyDirectory("demo-review"), "archived"));
    expect(archives).toHaveLength(1);
    expect(oldVersion).not.toBe((await profiles.loadActiveProfile("demo-review")).version);
  });

  it("质量阻塞时不提供启用并保留合法 draft", async () => {
    const oldVersion = (await profiles.loadActiveProfile("demo-review")).version;
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "保留 draft，稍后继续"], ["修订科目说明"]);

    await expect(controller(ui, { blocking: true }).run("demo-review")).resolves.toEqual({ status: "kept_draft", subjectId: "demo-review" });
    expect((await profiles.loadActiveProfile("demo-review")).version).toBe(oldVersion);
    expect(await profiles.readDraftFile("demo-review", "quality_report.md")).toContain("语义仍需确认");
  });

  it("用户放弃修订只删除 draft，active 保持不变", async () => {
    const oldVersion = (await profiles.loadActiveProfile("demo-review")).version;
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "放弃并删除 draft"], ["修订科目说明"]);

    await expect(controller(ui).run("demo-review")).resolves.toEqual({ status: "discarded", subjectId: "demo-review" });
    expect((await profiles.loadActiveProfile("demo-review")).version).toBe(oldVersion);
    await expect(profiles.loadDraftProfile("demo-review")).rejects.toBeDefined();
  });

  it("Agent 失败时保留 revision draft 且不修改 active", async () => {
    const oldVersion = (await profiles.loadActiveProfile("demo-review")).version;
    const ui = new RevisionUi(["应用这份修订计划"], ["修订科目说明"]);

    await expect(controller(ui, { failAt: "study_revise_profile_draft" }).run("demo-review"))
      .resolves.toMatchObject({ status: "failed", subjectId: "demo-review" });
    expect((await profiles.loadActiveProfile("demo-review")).version).toBe(oldVersion);
    expect((await profiles.loadDraftProfile("demo-review")).revision).toBe(2);
  });

  it("含糊反馈先澄清，不在首个计划中写入文件", async () => {
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "保留 draft，稍后继续"], ["这里改一下", "修改科目说明"]);

    await expect(controller(ui, { clarifyOnce: true }).run("demo-review"))
      .resolves.toEqual({ status: "kept_draft", subjectId: "demo-review" });
    expect(await profiles.readDraftFile("demo-review", "subject.md")).toBe("# 已修订的学习方法\n");
  });

  it("已有 draft 继续修订，不重复复制或增加 revision", async () => {
    const existing = await profiles.createRevisionDraft("demo-review");
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "保留 draft，稍后继续"], ["修订科目说明"]);

    await expect(controller(ui).run("demo-review")).resolves.toEqual({ status: "kept_draft", subjectId: "demo-review" });
    const revised = await profiles.loadDraftProfile("demo-review");
    expect(revised.revision).toBe(existing.revision);
    expect(revised.version).toBe(existing.version);
  });

  it("连续修订最终抵消 active 差异时禁止启用", async () => {
    const activeSubject = await profiles.readActiveFile("demo-review", "subject.md");
    await profiles.createRevisionDraft("demo-review");
    await profiles.applyDraftChanges("demo-review", [{
      path: "subject.md",
      operation: "update",
      reason: "上一轮修改",
      content: "# 临时修改\n",
    }]);
    const ui = new RevisionUi(["应用这份修订计划", "确认写入这些实际变更", "保留 draft，稍后继续"], ["恢复原说明"]);

    await expect(controller(ui, { patchContent: activeSubject }).run("demo-review"))
      .resolves.toEqual({ status: "kept_draft", subjectId: "demo-review" });
    expect(await profiles.readDraftFile("demo-review", "quality_report.md")).toContain("没有实际内容差异");
    expect((await profiles.loadActiveProfile("demo-review")).revision).toBe(1);
  });
});
