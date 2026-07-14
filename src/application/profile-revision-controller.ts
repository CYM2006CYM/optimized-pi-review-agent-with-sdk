import type { GraphRunResult } from "pi-loop-graph-sdk";
import type { StudyControllerUi } from "./study-session-controller.js";
import {
  inspectProfileStructure,
  plannedContentDifferences,
  profileContentDifferences,
  type ProfileFileSnapshot,
  type ProfileRevisionPlan,
  type ProfileRevisionQualityReview,
} from "../domain/profile-revision.js";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import {
  asProfileRevisionPatch,
  asProfileRevisionPlan,
  asProfileRevisionQuality,
  type StudyWalkingSkeletonGraphs,
} from "../graphs/study-walking-skeleton.js";
import type {
  ProfileFamilyRepository,
  ProfileRevisionCandidate,
} from "../repositories/profile-family-repository.js";

const APPLY_PLAN = "应用这份修订计划";
const APPLY_PATCH = "确认写入这些实际变更";
const REENTER_FEEDBACK = "重新输入修订意见";
const ENABLE_DRAFT = "确认启用为 active";
const CONTINUE_REVISION = "继续修改";
const KEEP_DRAFT = "保留 draft，稍后继续";
const DISCARD_DRAFT = "放弃并删除 draft";

const CORE_PATHS = new Set(["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"]);
const CORE_CONTEXT_BUDGET = 80_000;
const PATCH_CONTEXT_BUDGET = 120_000;

export interface ProfileRevisionControllerDependencies {
  profiles: ProfileFamilyRepository;
  graphs: StudyWalkingSkeletonGraphs;
  executeGraph: IsolatedGraphExecutor;
  ui: StudyControllerUi;
}

export type ProfileRevisionResult =
  | { status: "cancelled" }
  | { status: "enabled" | "kept_draft" | "discarded"; subjectId: string }
  | { status: "failed"; subjectId?: string; error: string };

function requireSuccessfulGraph(result: GraphRunResult): Record<string, unknown> {
  if (result.status !== "ok") {
    const reason = typeof result.result.reason === "string" ? `：${result.result.reason}` : "";
    throw new Error(`图 ${result.graphId} 未正常完成（${result.status}）${reason}`);
  }
  return result.result;
}

function candidateLabel(candidate: ProfileRevisionCandidate): string {
  const state = candidate.hasDraft
    ? `已有 draft r${candidate.draftRevision ?? "?"}`
    : `active r${candidate.activeRevision ?? "?"}`;
  return `${candidate.name} · ${candidate.subjectId} · ${state}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedFiles(files: readonly ProfileFileSnapshot[], budget: number): ProfileFileSnapshot[] {
  const selected: ProfileFileSnapshot[] = [];
  let remaining = budget;
  for (const file of files) {
    if (remaining <= 0) break;
    const characters = Array.from(file.content);
    const take = Math.min(characters.length, remaining);
    const suffix = take < characters.length ? "\n\n[内容因上下文预算截断]" : "";
    selected.push({ path: file.path, content: `${characters.slice(0, take).join("")}${suffix}` });
    remaining -= take;
  }
  return selected;
}

function coreFiles(files: readonly ProfileFileSnapshot[]): ProfileFileSnapshot[] {
  return boundedFiles(files.filter((file) => CORE_PATHS.has(file.path)), CORE_CONTEXT_BUDGET);
}

function filesForPlan(files: readonly ProfileFileSnapshot[], plan: ProfileRevisionPlan): Array<{ path: string; content: string | null }> {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const selected = plan.operations.map((operation) => ({
    path: operation.path,
    content: operation.operation === "create" ? null : fileMap.get(operation.path) ?? null,
  }));
  const characters = selected.reduce((total, file) => total + Array.from(file.content ?? "").length, 0);
  if (characters > PATCH_CONTEXT_BUDGET) {
    throw new Error(`本次受影响文件共 ${characters} 字符，超过 ${PATCH_CONTEXT_BUDGET} 字符预算；请缩小修订范围`);
  }
  return selected;
}

function qualityReport(
  quality: ProfileRevisionQualityReview,
  structureBlocking: readonly string[],
  structureWarnings: readonly string[],
): string {
  const lines = [quality.report_markdown.trim(), "", "## 代码结构门禁", ""];
  lines.push(structureBlocking.length > 0
    ? structureBlocking.map((item) => `- [阻塞] ${item}`).join("\n")
    : "- 未发现结构阻塞项");
  if (structureWarnings.length > 0) {
    lines.push("", ...structureWarnings.map((item) => `- [警告] ${item}`));
  }
  return `${lines.join("\n")}\n`;
}

function contentExcerpt(content: string | null): string {
  if (content === null) return "[文件不存在]";
  const lines = content.split(/\r?\n/u);
  const excerpt = lines.slice(0, 8).join("\n");
  return lines.length > 8 ? `${excerpt}\n[其余内容省略]` : excerpt;
}

function renderActualDifferences(differences: ReturnType<typeof plannedContentDifferences>): string {
  return differences.map((difference) => `## ${difference.path}\n\n修改前：\n\n\`\`\`text\n${contentExcerpt(difference.before)}\n\`\`\`\n\n修改后：\n\n\`\`\`text\n${contentExcerpt(difference.after)}\n\`\`\``).join("\n\n");
}

function parseArgs(args: string): { requestedSubjectId?: string; initialFeedback?: string } {
  const trimmed = args.trim();
  if (!trimmed) return {};
  const separator = trimmed.search(/\s/u);
  if (separator < 0) return { requestedSubjectId: trimmed };
  return {
    requestedSubjectId: trimmed.slice(0, separator),
    initialFeedback: trimmed.slice(separator).trim() || undefined,
  };
}

export class ProfileRevisionController {
  private readonly profiles: ProfileFamilyRepository;
  private readonly graphs: StudyWalkingSkeletonGraphs;
  private readonly executeGraph: IsolatedGraphExecutor;
  private readonly ui: StudyControllerUi;

  constructor(dependencies: ProfileRevisionControllerDependencies) {
    this.profiles = dependencies.profiles;
    this.graphs = dependencies.graphs;
    this.executeGraph = dependencies.executeGraph;
    this.ui = dependencies.ui;
  }

  async run(args: string): Promise<ProfileRevisionResult> {
    this.ui.setStatus("pi-study-helper", "正在准备 Profile 修订…");
    let subjectId: string | undefined;
    try {
      const parsedArgs = parseArgs(args);
      const candidates = await this.profiles.listRevisionCandidates();
      if (candidates.length === 0) {
        this.ui.notify("当前没有可修订的 active 或 draft Profile。", "warning");
        return { status: "cancelled" };
      }
      let candidate: ProfileRevisionCandidate | undefined;
      if (parsedArgs.requestedSubjectId) {
        candidate = candidates.find((item) => item.subjectId === parsedArgs.requestedSubjectId);
        if (!candidate) throw new Error(`找不到可修订的 Profile：${parsedArgs.requestedSubjectId}`);
      } else {
        const labels = candidates.map(candidateLabel);
        const selected = await this.ui.select("选择要修订的 Profile", labels);
        if (!selected) return { status: "cancelled" };
        candidate = candidates[labels.indexOf(selected)];
      }
      if (!candidate) return { status: "cancelled" };
      subjectId = candidate.subjectId;

      let feedback = parsedArgs.initialFeedback
        ?? await this.ui.input("输入修订意见", "说明哪里需要修改以及期望结果");
      if (!feedback?.trim()) return { status: "cancelled" };

      if (!candidate.hasDraft) {
        this.ui.setStatus("pi-study-helper", "正在从 active 创建安全修订草稿…");
        await this.profiles.createRevisionDraft(subjectId);
        this.ui.notify(`已为 ${subjectId} 创建 revision draft；原 active 尚未修改。`, "info");
      }

      for (;;) {
        const draft = await this.profiles.loadDraftProfile(subjectId);
        const beforeFiles = await this.profiles.listDraftFiles(subjectId);
        const existingPaths = beforeFiles.map((file) => file.path);
        this.ui.setStatus("pi-study-helper", "正在分析最小修订范围…");
        let plan = asProfileRevisionPlan(requireSuccessfulGraph(await this.executeGraph(
          this.graphs.planProfileRevision,
          {
            feedback: feedback.trim(),
            profile: draft,
            existingPaths,
            catalog: beforeFiles.map((file) => ({ path: file.path, characters: Array.from(file.content).length })),
            coreFiles: coreFiles(beforeFiles),
          },
        )), existingPaths);

        while (plan.requires_clarification) {
          const clarification = await this.ui.input("需要补充修订信息", plan.clarification_question);
          if (!clarification?.trim()) {
            this.ui.notify(`修订已暂停，draft ${subjectId} 保持不变。`, "info");
            return { status: "kept_draft", subjectId };
          }
          feedback = `${feedback.trim()}\n补充说明：${clarification.trim()}`;
          plan = asProfileRevisionPlan(requireSuccessfulGraph(await this.executeGraph(
            this.graphs.planProfileRevision,
            {
              feedback,
              profile: draft,
              existingPaths,
              catalog: beforeFiles.map((file) => ({ path: file.path, characters: Array.from(file.content).length })),
              coreFiles: coreFiles(beforeFiles),
            },
          )), existingPaths);
        }

        this.ui.notify(`# 修订计划\n\n${plan.summary}\n\n${plan.operations.map((item) => `- ${item.operation} \`${item.path}\`：${item.reason}`).join("\n")}${plan.warnings.length > 0 ? `\n\n警告：\n${plan.warnings.map((item) => `- ${item}`).join("\n")}` : ""}`, "info");
        const planAction = await this.ui.select("处理修订计划", [APPLY_PLAN, REENTER_FEEDBACK, KEEP_DRAFT]);
        if (planAction !== APPLY_PLAN) {
          if (planAction === REENTER_FEEDBACK) {
            const nextFeedback = await this.ui.input("重新输入修订意见", "说明哪里需要修改以及期望结果");
            if (nextFeedback?.trim()) {
              feedback = nextFeedback;
              continue;
            }
          }
          this.ui.notify(`修订已暂停，draft ${subjectId} 已保留。`, "info");
          return { status: "kept_draft", subjectId };
        }

        this.ui.setStatus("pi-study-helper", "正在生成受控文件补丁…");
        const patch = asProfileRevisionPatch(requireSuccessfulGraph(await this.executeGraph(
          this.graphs.reviseProfileDraft,
          {
            feedback: feedback.trim(),
            profile: draft,
            plan,
            currentFiles: filesForPlan(beforeFiles, plan),
          },
        )), plan);
        const actualDifferences = plannedContentDifferences(beforeFiles, patch.changes);
        const noOpPaths = patch.changes
          .map((change) => change.path)
          .filter((path) => !actualDifferences.some((difference) => difference.path === path));
        if (noOpPaths.length > 0) {
          throw new Error(`Agent 声称修改但文件内容没有变化：${noOpPaths.join("、")}`);
        }
        this.ui.notify(`# 实际文件变更预览\n\n${renderActualDifferences(actualDifferences)}`, "info");
        const patchAction = await this.ui.select("确认实际文件变更", [APPLY_PATCH, REENTER_FEEDBACK, KEEP_DRAFT]);
        if (patchAction !== APPLY_PATCH) {
          if (patchAction === REENTER_FEEDBACK) {
            const nextFeedback = await this.ui.input("重新输入修订意见", "说明哪里需要修改以及期望结果");
            if (nextFeedback?.trim()) {
              feedback = nextFeedback;
              continue;
            }
          }
          this.ui.notify(`修订补丁尚未写入，draft ${subjectId} 已保留。`, "info");
          return { status: "kept_draft", subjectId };
        }
        await this.profiles.applyDraftChanges(subjectId, patch.changes);

        const revisedFiles = await this.profiles.listDraftFiles(subjectId);
        const inspection = inspectProfileStructure(revisedFiles);
        const unresolved = unique(patch.unresolved);
        let noNetChangeBlocking: string[] = [];
        if (candidate.hasActive) {
          const activeFiles = await this.profiles.listActiveFiles(subjectId);
          if (profileContentDifferences(activeFiles, revisedFiles).length === 0) {
            noNetChangeBlocking = ["修订 draft 与当前 active 没有实际内容差异"];
          }
        }
        const structureBlocking = unique([
          ...inspection.blockingIssues,
          ...unresolved.map((item) => `未解决：${item}`),
          ...noNetChangeBlocking,
        ]);
        const changedPaths = new Set(plan.operations.map((item) => item.path));
        this.ui.setStatus("pi-study-helper", "正在独立审查修订质量…");
        const quality = asProfileRevisionQuality(requireSuccessfulGraph(await this.executeGraph(
          this.graphs.reviewProfileDraft,
          {
            feedback: feedback.trim(),
            plan,
            patchSummary: patch.summary,
            structureInspection: { ...inspection, blockingIssues: structureBlocking },
            coreFiles: coreFiles(revisedFiles),
            changedFiles: revisedFiles.filter((file) => changedPaths.has(file.path)),
          },
        )));
        const recommendationBlocking = quality.recommendation === "revise" && quality.blocking_issues.length === 0
          ? ["独立质量审查建议继续修订"]
          : [];
        const blockingIssues = unique([...structureBlocking, ...quality.blocking_issues, ...recommendationBlocking]);
        const warnings = unique([...inspection.warnings, ...quality.warnings, ...plan.warnings]);
        await this.profiles.applyDraftChanges(subjectId, [{
          path: "quality_report.md",
          operation: "update",
          reason: "记录本轮独立修订质量审查",
          content: qualityReport(quality, blockingIssues, warnings),
        }]);

        this.ui.notify(`# Profile 修订完成\n\n${patch.summary}\n\n文件：${plan.operations.map((item) => item.path).join("、")}\n结构：${inspection.metrics.chapters} 章、${inspection.metrics.sections} 小节、${inspection.metrics.knowledgePoints} 个知识点、${inspection.metrics.cards} 张卡片\n阻塞项：${blockingIssues.length}\n警告：${warnings.length}`, blockingIssues.length > 0 ? "warning" : "info");
        const actions = blockingIssues.length > 0
          ? [CONTINUE_REVISION, KEEP_DRAFT, DISCARD_DRAFT]
          : [ENABLE_DRAFT, CONTINUE_REVISION, KEEP_DRAFT, DISCARD_DRAFT];
        const action = await this.ui.select("处理修订 draft", actions);
        if (action === ENABLE_DRAFT && blockingIssues.length === 0) {
          const active = await this.profiles.enableDraft(subjectId);
          this.ui.notify(`Profile ${subjectId} 修订版 r${active.revision} 已启用；旧 active 已归档。`, "info");
          return { status: "enabled", subjectId };
        }
        if (action === DISCARD_DRAFT) {
          await this.profiles.discardDraft(subjectId);
          this.ui.notify(`Profile ${subjectId} 的修订 draft 已删除；active 未修改。`, "info");
          return { status: "discarded", subjectId };
        }
        if (action === CONTINUE_REVISION) {
          const nextFeedback = await this.ui.input("继续输入修订意见", "说明下一处需要修改的内容");
          if (nextFeedback?.trim()) {
            feedback = nextFeedback;
            continue;
          }
        }
        this.ui.notify(`Profile ${subjectId} 的修订 draft 已保留。`, "info");
        return { status: "kept_draft", subjectId };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retained = subjectId ? `；${subjectId} 的 active 未修改，已有 draft 已保留` : "";
      this.ui.notify(`Profile 修订失败：${message}${retained}。`, "error");
      return { status: "failed", subjectId, error: message };
    } finally {
      this.ui.setStatus("pi-study-helper", undefined);
    }
  }
}
