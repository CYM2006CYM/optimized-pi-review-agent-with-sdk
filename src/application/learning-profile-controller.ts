import type { GraphRunResult } from "pi-loop-graph-sdk";
import type { StudyControllerUi } from "./study-session-controller.js";
import {
  assembleLearningProfile,
  buildLearningProfileEvidence,
} from "../domain/learning-profile-evidence.js";
import type { LearningProfile } from "../domain/types.js";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import {
  asLearningProfileCandidate,
  type StudyWalkingSkeletonGraphs,
} from "../graphs/study-walking-skeleton.js";
import type {
  PendingLearningRecordBatch,
  PrivateMemoryRepository,
} from "../repositories/private-memory-repository.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

const SELECT_ALL = "全部可用记录";
const CONFIRM = "确认写入画像并归档记录";
const CANCEL = "取消";

export interface LearningProfileControllerDependencies {
  profiles: ProfileFamilyRepository;
  memory: PrivateMemoryRepository;
  graphs: StudyWalkingSkeletonGraphs;
  executeGraph: IsolatedGraphExecutor;
  ui: StudyControllerUi;
  now?: () => Date;
}

export type LearningProfileUpdateResult =
  | { status: "none" | "cancelled" }
  | { status: "completed"; subjectId: string; batchIds: string[]; profile: LearningProfile }
  | { status: "failed"; error: string };

function requireSuccessfulGraph(result: GraphRunResult): Record<string, unknown> {
  if (result.status !== "ok") {
    const reason = typeof result.result.reason === "string" ? `：${result.result.reason}` : "";
    throw new Error(`图 ${result.graphId} 未正常完成（${result.status}）${reason}`);
  }
  return result.result;
}

function batchLabel(batch: PendingLearningRecordBatch): string {
  const summary = batch.summaryMarkdown?.trim() ? "有总结" : "无总结";
  return `${batch.session.mode} · ${batch.session.totalQuestions} 题 · ${batch.session.status} · ${summary} · ${batch.batchId}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function renderLearningProfilePreview(profile: LearningProfile): string {
  const list = (values: readonly string[]) => values.length > 0 ? values.map((item) => `- ${item}`).join("\n") : "- 暂无";
  return `# 学习画像候选

累计题目：${profile.total_questions}
累计正确：${profile.total_correct}
累计正确率：${percent(profile.accuracy)}

## 总体概况

${profile.profile_summary}

## 已有掌握证据

${list(profile.strengths)}

## 薄弱点

${list(profile.weak_points)}

## 尚待验证

${list(profile.unverified_topics)}

## 下一步建议

${list(profile.recommendations)}`;
}

export class LearningProfileController {
  private readonly profiles: ProfileFamilyRepository;
  private readonly memory: PrivateMemoryRepository;
  private readonly graphs: StudyWalkingSkeletonGraphs;
  private readonly executeGraph: IsolatedGraphExecutor;
  private readonly ui: StudyControllerUi;
  private readonly now: () => Date;

  constructor(dependencies: LearningProfileControllerDependencies) {
    this.profiles = dependencies.profiles;
    this.memory = dependencies.memory;
    this.graphs = dependencies.graphs;
    this.executeGraph = dependencies.executeGraph;
    this.ui = dependencies.ui;
    this.now = dependencies.now ?? (() => new Date());
  }

  async run(args: string): Promise<LearningProfileUpdateResult> {
    this.ui.setStatus("pi-study-helper", "正在准备学习画像…");
    try {
      await this.profiles.seedDemoProfile();
      const activeProfiles = await this.profiles.listActiveProfiles();
      if (activeProfiles.length === 0) {
        this.ui.notify("还没有可生成学习画像的 active 资料包。", "warning");
        return { status: "none" };
      }

      const requestedSubjectId = args.trim();
      let subjectId = activeProfiles.find((profile) => profile.subjectId === requestedSubjectId)?.subjectId;
      if (!subjectId) {
        const labels = activeProfiles.map((profile) => `${profile.name} · ${profile.subjectId}`);
        const selected = await this.ui.select("选择学习画像科目", labels);
        subjectId = activeProfiles[labels.indexOf(selected ?? "")]?.subjectId;
      }
      if (!subjectId) return { status: "cancelled" };

      const pending = await this.memory.listPendingBatches(subjectId);
      const eligible = pending.filter((batch) => batch.session.status !== "running" && batch.attempts.length > 0);
      if (eligible.length === 0) {
        this.ui.notify("没有可用于更新学习画像的未消费学习记录。", "info");
        return { status: "none" };
      }

      const batchLabels = eligible.map(batchLabel);
      const selection = await this.ui.select("选择要消费的学习记录", [
        `${SELECT_ALL}（${eligible.length} 个）`,
        ...batchLabels,
      ]);
      if (!selection) return { status: "cancelled" };
      const selectedBatches = selection.startsWith(SELECT_ALL)
        ? eligible
        : eligible.filter((batch) => batchLabel(batch) === selection);
      if (selectedBatches.length === 0) return { status: "cancelled" };

      const existingProfile = await this.memory.loadLearningProfile(subjectId);
      const evidence = buildLearningProfileEvidence(subjectId, existingProfile, selectedBatches);
      this.ui.setStatus("pi-study-helper", "正在生成学习画像候选…");
      const candidate = asLearningProfileCandidate(requireSuccessfulGraph(await this.executeGraph(
        this.graphs.updateLearningProfile,
        { evidence },
      )));
      const profile = assembleLearningProfile(evidence, candidate, this.now().toISOString());
      this.ui.notify(renderLearningProfilePreview(profile), "info");

      const confirmation = await this.ui.select("确认学习画像", [CONFIRM, CANCEL]);
      if (confirmation !== CONFIRM) {
        this.ui.notify("已取消学习画像更新；原画像和学习记录均未修改。", "info");
        return { status: "cancelled" };
      }

      const batchIds = selectedBatches.map((batch) => batch.batchId);
      await this.memory.saveLearningProfileAndArchive(subjectId, profile, batchIds);
      this.ui.notify(`学习画像已更新，并归档 ${batchIds.length} 个已消费记录。`, "info");
      return { status: "completed", subjectId, batchIds, profile };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ui.notify(`学习画像更新失败：${message}。原画像和学习记录保持不变。`, "error");
      return { status: "failed", error: message };
    } finally {
      this.ui.setStatus("pi-study-helper", undefined);
    }
  }
}
