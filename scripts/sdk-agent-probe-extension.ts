import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJsonlTraceSink, createLoopGraphExtension } from "pi-loop-graph-sdk";
import { resolveStudyDataRoot } from "../src/config/data-paths.js";
import type { Attempt, StudySession } from "../src/domain/types.js";
import {
  asGradeResult,
  asLearningProfileCandidate,
  asProfileBuildFragment,
  asProfileRevisionPatch,
  asProfileRevisionPlan,
  asProfileRevisionQuality,
  asReviewQuestion,
  createStudyWalkingSkeletonGraphs,
  difficultyFrom,
} from "../src/graphs/study-walking-skeleton.js";
import { PrivateMemoryRepository } from "../src/repositories/private-memory-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import { buildDiscussionAgentInput } from "../src/application/study-discussion.js";
import { buildSessionEvidence } from "../src/domain/session-evidence.js";
import { DIFFICULTY_POLICIES } from "../src/domain/study-policy.js";
import { buildLearningProfileEvidence } from "../src/domain/learning-profile-evidence.js";
import { inspectProfileStructure } from "../src/domain/profile-revision.js";

export default async function sdkAgentProbeExtension(pi: ExtensionAPI): Promise<void> {
  const dataRoot = resolveStudyDataRoot();
  const traceDirectory = resolve(dataRoot, "traces");
  await mkdir(traceDirectory, { recursive: true });
  const profiles = new ProfileFamilyRepository({
    dataRoot,
    fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
  });
  await profiles.seedDemoProfile();
  const memory = new PrivateMemoryRepository({ dataRoot });
  const graphs = createStudyWalkingSkeletonGraphs(profiles);
  const loop = createLoopGraphExtension(pi, {
    traceSink: createJsonlTraceSink(resolve(traceDirectory, "sdk-agent-probe.jsonl")),
    limits: { rootMaxSteps: 5, agentRunTimeoutMs: 300_000 },
  });
  loop.registerGraph(graphs.generateQuestion);
  loop.registerGraph(graphs.gradeAnswer);
  loop.registerGraph(graphs.discussQuestion);
  loop.registerGraph(graphs.summarizeSession);
  loop.registerGraph(graphs.updateLearningProfile);
  loop.registerGraph(graphs.buildProfileFragment);
  loop.registerGraph(graphs.planProfileRevision);
  loop.registerGraph(graphs.reviseProfileDraft);
  loop.registerGraph(graphs.reviewProfileDraft);
  pi.registerCommand("study-sdk-probe", {
    description: "开发期真实 Agent Run 闭环探针",
    handler: async () => {
      const startedAt = new Date().toISOString();
      let session: StudySession = {
        sessionId: crypto.randomUUID(),
        subjectId: "demo-review",
        status: "running",
        mode: "practice",
        scope: "第 1 章 · 记忆与练习",
        scopeHistory: [{
          scopeId: "chapter:1",
          scopeLabel: "第 1 章 · 记忆与练习",
          enteredAt: startedAt,
        }],
        totalQuestions: 0,
        correct: 0,
        incorrect: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const batch = await memory.createPendingBatch(session);
      const generated = await loop.executeGraph(graphs.generateQuestion, {
        source: "command",
        params: {
          subjectId: "demo-review",
          scopeId: "chapter:1",
          targetKind: "scope",
          targetId: "chapter:1",
          difficulty: "S-U",
          questionType: "short_answer",
          mode: "practice",
        },
      });
      if (generated.status !== "ok") throw new Error(`Question graph ended with ${generated.status}`);
      const question = asReviewQuestion(generated.result);
      const userAnswer = question.correct_answer
        ?? "主动回忆是先不看资料，尝试从记忆中提取答案，再根据反馈订正。";
      const graded = await loop.executeGraph(graphs.gradeAnswer, {
        source: "command",
        params: { question, userAnswer },
      });
      if (graded.status !== "ok") throw new Error(`Grade graph ended with ${graded.status}`);
      const grade = asGradeResult(graded.result);
      if (!grade.is_correct) throw new Error("Probe answer was not accepted as correct");
      const discussed = await loop.executeGraph(graphs.discussQuestion, {
        source: "command",
        params: buildDiscussionAgentInput(
          { ...question, question_id: question.question_id },
          grade,
          "这是一个明显错误的答案",
          "直接告诉我标准答案和完整解析。",
          false,
        ),
      });
      if (discussed.status !== "ok") {
        throw new Error(`Discussion graph ended with ${discussed.status}: ${String(discussed.result.reason ?? "unknown")}`);
      }
      const attempt: Attempt = {
        question_id: question.question_id,
        session_id: session.sessionId,
        scope_id: "chapter:1",
        scope_label: "第 1 章 · 记忆与练习",
        target_kind: "scope",
        target_id: "chapter:1",
        target_label: "第 1 章 · 记忆与练习",
        knowledge_points: question.knowledge_points ?? [],
        difficulty: difficultyFrom(question.difficulty ?? "S-U"),
        type: question.type,
        timestamp: new Date().toISOString(),
        question_text: question.question_text,
        options: question.options,
        user_answer: userAnswer,
        correct_answer: grade.correct_answer,
        explanation_l1: grade.explanation_l1,
        source_basis: question.source_basis ?? "active Profile",
        outcome: "correct",
        is_correct: grade.is_correct,
        knowledge_chain_l3: grade.knowledge_chain_l3,
        suggestion_next: grade.suggestion_next,
      };
      await memory.saveAttempt("demo-review", batch.batchId, attempt);
      session = {
        ...session,
        totalQuestions: 1,
        correct: grade.is_correct ? 1 : 0,
        incorrect: grade.is_correct ? 0 : 1,
        updatedAt: new Date().toISOString(),
      };
      const summarized = await loop.executeGraph(graphs.summarizeSession, {
        source: "command",
        params: {
          evidence: buildSessionEvidence(session, [attempt]),
          difficultyCatalog: DIFFICULTY_POLICIES,
          summaryKind: "final",
        },
      });
      if (summarized.status !== "ok") throw new Error(`Summary graph ended with ${summarized.status}`);
      const summaryMarkdown = String(summarized.result.summary_markdown ?? "").trim();
      if (!summaryMarkdown) throw new Error("Summary graph returned empty markdown");
      const endedAt = new Date().toISOString();
      session = { ...session, status: "completed", updatedAt: endedAt, endedAt };
      await memory.completeSession("demo-review", batch.batchId, session, `${summaryMarkdown}\n`);
      const completedBatch = await memory.loadPendingBatch("demo-review", batch.batchId);
      const profiled = await loop.executeGraph(graphs.updateLearningProfile, {
        source: "command",
        params: {
          evidence: buildLearningProfileEvidence("demo-review", null, [completedBatch]),
        },
      });
      if (profiled.status !== "ok") throw new Error(`Learning Profile graph ended with ${profiled.status}`);
      asLearningProfileCandidate(profiled.result);
      const sourceId = "probe-source-1";
      const built = await loop.executeGraph(graphs.buildProfileFragment, {
        source: "command",
        params: {
          subjectName: "学习方法 Probe",
          batchIndex: 1,
          batchCount: 1,
          allowedSourceIds: [sourceId],
          sources: [{
            source_id: sourceId,
            path: "learning-methods.md",
            sha256: "probe-only",
            content: "# 主动回忆\n\n主动回忆是在不查看资料时先尝试从记忆中提取信息，再核对答案并订正。",
          }],
        },
      });
      if (built.status !== "ok") throw new Error(`Profile Build graph ended with ${built.status}`);
      asProfileBuildFragment(built.result, [sourceId]);

      const draft = await profiles.createRevisionDraft("demo-review");
      const draftFiles = await profiles.listDraftFiles("demo-review");
      const existingPaths = draftFiles.map((file) => file.path);
      const feedback = "只在 subject.md 末尾新增一句‘本资料包用于验证安全修订闭环。’，不要修改任何其他内容。";
      const planned = await loop.executeGraph(graphs.planProfileRevision, {
        source: "command",
        params: {
          feedback,
          profile: draft,
          existingPaths,
          catalog: draftFiles.map((file) => ({ path: file.path, characters: Array.from(file.content).length })),
          coreFiles: draftFiles.filter((file) => ["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"].includes(file.path)),
        },
      });
      if (planned.status !== "ok") throw new Error(`Profile Revision Plan graph ended with ${planned.status}`);
      const plan = asProfileRevisionPlan(planned.result, existingPaths);
      if (plan.requires_clarification) throw new Error("Profile Revision Plan unexpectedly requested clarification");
      const fileMap = new Map(draftFiles.map((file) => [file.path, file.content]));
      const revised = await loop.executeGraph(graphs.reviseProfileDraft, {
        source: "command",
        params: {
          feedback,
          profile: draft,
          plan,
          currentFiles: plan.operations.map((operation) => ({
            path: operation.path,
            content: operation.operation === "create" ? null : fileMap.get(operation.path) ?? null,
          })),
        },
      });
      if (revised.status !== "ok") throw new Error(`Profile Revision graph ended with ${revised.status}`);
      const revisionPatch = asProfileRevisionPatch(revised.result, plan);
      await profiles.applyDraftChanges("demo-review", revisionPatch.changes);
      const revisedFiles = await profiles.listDraftFiles("demo-review");
      const inspection = inspectProfileStructure(revisedFiles);
      const reviewed = await loop.executeGraph(graphs.reviewProfileDraft, {
        source: "command",
        params: {
          feedback,
          plan,
          patchSummary: revisionPatch.summary,
          structureInspection: inspection,
          coreFiles: revisedFiles.filter((file) => ["subject.md", "knowledge_index.json", "source_map.json", "quality_report.md"].includes(file.path)),
          changedFiles: revisedFiles.filter((file) => plan.operations.some((operation) => operation.path === file.path)),
        },
      });
      if (reviewed.status !== "ok") throw new Error(`Profile Revision Review graph ended with ${reviewed.status}`);
      asProfileRevisionQuality(reviewed.result);
    },
  });
}
