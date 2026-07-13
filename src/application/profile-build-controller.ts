import type { GraphRunResult } from "pi-loop-graph-sdk";
import type { StudyControllerUi } from "./study-session-controller.js";
import { assembleCanonicalProfile } from "../domain/profile-build.js";
import {
  createSourceBatches,
  inventorySourceDirectory,
  loadSourceBatch,
} from "../domain/source-inventory.js";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import {
  asProfileBuildFragment,
  type StudyWalkingSkeletonGraphs,
} from "../graphs/study-walking-skeleton.js";
import type { ProfileBuildJob, ProfileBuildJobRepository } from "../repositories/profile-build-job-repository.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

const NEW_BUILD = "新建 Profile 构建";
const ENABLE_DRAFT = "确认启用为 active";
const KEEP_DRAFT = "保留 draft，稍后处理";
const DISCARD_DRAFT = "放弃并删除 draft";

export interface ProfileBuildControllerDependencies {
  profiles: ProfileFamilyRepository;
  jobs: ProfileBuildJobRepository;
  graphs: StudyWalkingSkeletonGraphs;
  executeGraph: IsolatedGraphExecutor;
  ui: StudyControllerUi;
}

export type ProfileBuildResult =
  | { status: "cancelled" }
  | { status: "enabled" | "kept_draft" | "discarded"; jobId: string; subjectId: string }
  | { status: "failed"; jobId?: string; error: string };

function requireSuccessfulGraph(result: GraphRunResult): Record<string, unknown> {
  if (result.status !== "ok") {
    const reason = typeof result.result.reason === "string" ? `：${result.result.reason}` : "";
    throw new Error(`图 ${result.graphId} 未正常完成（${result.status}）${reason}`);
  }
  return result.result;
}

function jobLabel(job: ProfileBuildJob): string {
  return `${job.subjectName} · ${job.subjectId} · ${job.nextBatchIndex}/${job.batches.length} · ${job.status} · ${job.jobId}`;
}

export class ProfileBuildController {
  private readonly profiles: ProfileFamilyRepository;
  private readonly jobs: ProfileBuildJobRepository;
  private readonly graphs: StudyWalkingSkeletonGraphs;
  private readonly executeGraph: IsolatedGraphExecutor;
  private readonly ui: StudyControllerUi;

  constructor(dependencies: ProfileBuildControllerDependencies) {
    this.profiles = dependencies.profiles;
    this.jobs = dependencies.jobs;
    this.graphs = dependencies.graphs;
    this.executeGraph = dependencies.executeGraph;
    this.ui = dependencies.ui;
  }

  async run(args: string): Promise<ProfileBuildResult> {
    this.ui.setStatus("pi-study-helper", "正在准备 Profile 构建…");
    let job: ProfileBuildJob | undefined;
    try {
      const unfinished = await this.jobs.listUnfinishedJobs();
      if (unfinished.length > 0) {
        const labels = unfinished.map(jobLabel);
        const selected = await this.ui.select("继续构建或新建", [...labels, NEW_BUILD]);
        if (!selected) return { status: "cancelled" };
        job = unfinished[labels.indexOf(selected)];
        if (job?.status === "failed") job = await this.jobs.setStatus(job.jobId, "extracting");
      }

      if (!job) {
        const sourceRoot = args.trim() || await this.ui.input("输入源资料目录", "绝对路径；递归读取 .md/.txt");
        if (!sourceRoot?.trim()) return { status: "cancelled" };
        const subjectId = await this.ui.input("输入新资料包 ID", "仅小写字母、数字和连字符");
        if (!subjectId?.trim()) return { status: "cancelled" };
        const subjectName = await this.ui.input("输入科目名称", "例如：离散数学");
        if (!subjectName?.trim()) return { status: "cancelled" };

        this.ui.setStatus("pi-study-helper", "正在盘点源资料并计算 hash…");
        const inventory = await inventorySourceDirectory(sourceRoot.trim());
        const batches = createSourceBatches(inventory);
        const normalizedSubjectId = subjectId.trim();
        const normalizedSubjectName = subjectName.trim();
        await this.profiles.createDraftProfile({ subjectId: normalizedSubjectId, name: normalizedSubjectName });
        try {
          job = await this.jobs.createJob({
            subjectId: normalizedSubjectId,
            subjectName: normalizedSubjectName,
            inventory,
            batches,
          });
        } catch (error) {
          await this.profiles.discardDraft(normalizedSubjectId);
          throw error;
        }
      }

      if (job.status === "extracting") {
        for (let index = job.nextBatchIndex; index < job.batches.length; index += 1) {
          const batch = job.batches[index];
          if (!batch) throw new Error(`Missing source batch ${index}`);
          this.ui.setStatus("pi-study-helper", `正在提取资料语义 ${index + 1}/${job.batches.length}…`);
          const loaded = await loadSourceBatch(job.inventory, batch);
          const allowedSourceIds = loaded.sources.map((source) => source.sourceId);
          const fragment = asProfileBuildFragment(requireSuccessfulGraph(await this.executeGraph(
            this.graphs.buildProfileFragment,
            {
              subjectName: job.subjectName,
              batchIndex: index + 1,
              batchCount: job.batches.length,
              allowedSourceIds,
              sources: loaded.sources.map((source) => ({
                source_id: source.sourceId,
                path: source.relativePath,
                sha256: source.sha256,
                content: source.content,
              })),
            },
          )), allowedSourceIds);
          job = await this.jobs.saveFragment(job.jobId, index, fragment);
        }
      }

      this.ui.setStatus("pi-study-helper", "正在组装 canonical draft 并执行质量检查…");
      const fragments = await this.jobs.loadFragments(job.jobId);
      const build = assembleCanonicalProfile(job.subjectName, job.inventory, fragments);
      for (const [relativePath, content] of build.files) {
        await this.profiles.writeDraftFile(job.subjectId, relativePath, content);
      }
      await this.profiles.loadDraftProfile(job.subjectId);
      job = await this.jobs.setStatus(job.jobId, "draft_ready");
      this.ui.notify(`# Profile draft 已生成

科目：${job.subjectName}（${job.subjectId}）
源文件：${job.inventory.files.length}
批次数：${job.batches.length}
章节：${build.metrics.chapters}
小节：${build.metrics.sections}
知识点/卡片：${build.metrics.knowledgePoints}
考点总结：${build.metrics.examPoints}
已映射来源：${build.metrics.mappedSources}/${job.inventory.files.length}
警告：${build.metrics.warnings.length}`, "info");

      const action = await this.ui.select("处理 Profile draft", [ENABLE_DRAFT, KEEP_DRAFT, DISCARD_DRAFT]);
      if (!action) return { status: "cancelled" };
      if (action === ENABLE_DRAFT) {
        await this.profiles.enableDraft(job.subjectId);
        await this.jobs.setStatus(job.jobId, "enabled");
        this.ui.notify(`Profile ${job.subjectId} 已启用，可通过 /study ${job.subjectId} 开始学习。`, "info");
        return { status: "enabled", jobId: job.jobId, subjectId: job.subjectId };
      }
      if (action === DISCARD_DRAFT) {
        await this.profiles.discardDraft(job.subjectId);
        await this.jobs.setStatus(job.jobId, "discarded");
        this.ui.notify("Profile draft 已删除；源资料未修改。", "info");
        return { status: "discarded", jobId: job.jobId, subjectId: job.subjectId };
      }
      await this.jobs.setStatus(job.jobId, "kept_draft");
      this.ui.notify(`Profile draft 已保留：${job.subjectId}。`, "info");
      return { status: "kept_draft", jobId: job.jobId, subjectId: job.subjectId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job && ["extracting", "draft_ready"].includes(job.status)) {
        try {
          await this.jobs.setStatus(job.jobId, "failed", message);
        } catch {
          // 原始构建错误更重要；损坏 checkpoint 由 doctor 处理。
        }
      }
      const recovery = job
        ? "已保存 draft 与 checkpoint，可重新执行 /study-build 继续。"
        : "尚未创建 draft 或 checkpoint，请修正输入后重新执行 /study-build。";
      this.ui.notify(`Profile 构建失败：${message}。${recovery}`, "error");
      return { status: "failed", jobId: job?.jobId, error: message };
    } finally {
      this.ui.setStatus("pi-study-helper", undefined);
    }
  }
}
