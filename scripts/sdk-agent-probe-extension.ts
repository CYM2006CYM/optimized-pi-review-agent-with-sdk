import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createJsonlTraceSink, createLoopGraphExtension } from "pi-loop-graph-sdk";
import { resolveStudyDataRoot } from "../src/config/data-paths.js";
import type { Attempt, StudySession } from "../src/domain/types.js";
import {
  asGradeResult,
  asReviewQuestion,
  createStudyWalkingSkeletonGraphs,
  difficultyFrom,
} from "../src/graphs/study-walking-skeleton.js";
import { PrivateMemoryRepository } from "../src/repositories/private-memory-repository.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";
import { buildDiscussionAgentInput } from "../src/application/study-discussion.js";

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
          difficulty: "S-U",
          questionType: "short_answer",
          mode: "practice",
        },
      });
      if (generated.status !== "ok") throw new Error(`Question graph ended with ${generated.status}`);
      const question = asReviewQuestion(generated.result);
      const userAnswer = "主动回忆是先不看资料，尝试从记忆中提取答案，再根据反馈订正。";
      const graded = await loop.executeGraph(graphs.gradeAnswer, {
        source: "command",
        params: { question, userAnswer },
      });
      if (graded.status !== "ok") throw new Error(`Grade graph ended with ${graded.status}`);
      const grade = asGradeResult(graded.result);
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
        params: { session, attempts: [attempt] },
      });
      if (summarized.status !== "ok") throw new Error(`Summary graph ended with ${summarized.status}`);
      const summaryMarkdown = String(summarized.result.summary_markdown ?? "").trim();
      if (!summaryMarkdown) throw new Error("Summary graph returned empty markdown");
      const endedAt = new Date().toISOString();
      session = { ...session, status: "completed", updatedAt: endedAt, endedAt };
      await memory.completeSession("demo-review", batch.batchId, session, `${summaryMarkdown}\n`);
    },
  });
}
