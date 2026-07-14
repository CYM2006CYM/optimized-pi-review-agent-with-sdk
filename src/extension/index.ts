import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createJsonlTraceSink } from "pi-loop-graph-sdk";
import { LearningProfileController } from "../application/learning-profile-controller.js";
import { ProfileBuildController } from "../application/profile-build-controller.js";
import { ProfileRevisionController } from "../application/profile-revision-controller.js";
import {
  isRecoverableStudyBatch,
  StudySessionController,
} from "../application/study-session-controller.js";
import { resolveStudyDataRoot } from "../config/data-paths.js";
import { createIsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import { createStudyWalkingSkeletonGraphs } from "../graphs/study-walking-skeleton.js";
import { PrivateMemoryRepository } from "../repositories/private-memory-repository.js";
import { ProfileBuildJobRepository } from "../repositories/profile-build-job-repository.js";
import { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";

export default async function studyHelperExtension(pi: ExtensionAPI): Promise<void> {
  const dataRoot = resolveStudyDataRoot();
  const traceDirectory = resolve(dataRoot, "traces");
  await mkdir(traceDirectory, { recursive: true });
  const profiles = new ProfileFamilyRepository({ dataRoot });
  const memory = new PrivateMemoryRepository({ dataRoot });
  const buildJobs = new ProfileBuildJobRepository({ dataRoot });
  const graphs = createStudyWalkingSkeletonGraphs(profiles);
  const traceSink = createJsonlTraceSink(resolve(traceDirectory, "loop-graph-lifecycle.jsonl"));

  const executorFor = (ctx: ExtensionCommandContext) => {
    let executeGraph: ReturnType<typeof createIsolatedGraphExecutor> | undefined;
    return (graph: Parameters<ReturnType<typeof createIsolatedGraphExecutor>>[0], params: Record<string, unknown>) => {
      executeGraph ??= createIsolatedGraphExecutor(ctx, {
        traceSink,
        limits: { rootMaxSteps: 10, agentRunTimeoutMs: 300_000 },
      });
      return executeGraph(graph, params);
    };
  };

  const controllerFor = (ctx: ExtensionCommandContext): StudySessionController => new StudySessionController({
    profiles,
    memory,
    graphs,
    executeGraph: executorFor(ctx),
    ui: ctx.ui,
  });

  pi.registerCommand("study", {
    description: "启动一次任务驱动学习会话",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再开始学习。", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("请先选择可用模型再开始学习。", "warning");
        return;
      }
      await controllerFor(ctx).run(args);
    },
  });

  pi.registerCommand("study-recover", {
    description: "补总结或中断上次未完成的学习会话",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再处理未完成会话。", "warning");
        return;
      }
      await controllerFor(ctx).recoverRunningSession();
    },
  });

  pi.registerCommand("study-profile", {
    description: "从未消费学习记录生成或更新用户学习画像",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再更新学习画像。", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("请先选择可用模型再生成学习画像。", "warning");
        return;
      }
      await new LearningProfileController({
        profiles,
        memory,
        graphs,
        executeGraph: executorFor(ctx),
        ui: ctx.ui,
      }).run(args);
    },
  });

  pi.registerCommand("study-build", {
    description: "从 Markdown/txt 源目录构建新的 canonical Profile",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再构建 Profile。", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("请先选择可用模型再构建 Profile。", "warning");
        return;
      }
      await new ProfileBuildController({
        profiles,
        jobs: buildJobs,
        graphs,
        executeGraph: executorFor(ctx),
        ui: ctx.ui,
      }).run(args);
    },
  });

  pi.registerCommand("study-revise", {
    description: "安全修订 active 或已有 draft Profile",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再修订 Profile。", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("请先选择可用模型再修订 Profile。", "warning");
        return;
      }
      await new ProfileRevisionController({
        profiles,
        graphs,
        executeGraph: executorFor(ctx),
        ui: ctx.ui,
      }).run(args);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      await profiles.seedDemoProfile();
      const activeProfiles = await profiles.listActiveProfiles();
      let recoveryCount = 0;
      for (const profile of activeProfiles) {
        const batches = await memory.listPendingBatches(profile.subjectId);
        recoveryCount += batches.filter(isRecoverableStudyBatch).length;
      }
      const recoveryNotice = recoveryCount > 0
        ? `；发现 ${recoveryCount} 个待处理会话，可使用 /study-recover 处理`
        : "";
      ctx.ui.notify(`Pi Study Helper 已加载；使用 /study 开始学习${recoveryNotice}。`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Pi Study Helper 已加载，但初始化检查失败：${message}`, "warning");
    }
  });
}
