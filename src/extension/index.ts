import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createJsonlTraceSink,
  type GraphRunResult,
} from "pi-loop-graph-sdk";
import { resolveStudyDataRoot } from "../config/data-paths.js";
import { listStudyScopes, loadActiveStudyContext } from "../domain/study-profile.js";
import type {
  Attempt,
  DifficultyLevel,
  GradeResult,
  QuestionType,
  ReviewMode,
  StudySession,
} from "../domain/types.js";
import {
  asGradeResult,
  asReviewQuestion,
  createStudyWalkingSkeletonGraphs,
  difficultyFrom,
} from "../graphs/study-walking-skeleton.js";
import { createIsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import { PrivateMemoryRepository } from "../repositories/private-memory-repository.js";
import { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import {
  StudyTuiGateway,
  type QuestionViewModel,
  type QuestionViewType,
} from "../tui/study-tui-gateway.js";
import { buildDiscussionAgentInput } from "../application/study-discussion.js";
import { executeOptionalDiscussion } from "../application/optional-discussion.js";

const DIFFICULTIES: Array<{ label: string; value: DifficultyLevel }> = [
  { label: "S-R · 基础记忆", value: "S-R" },
  { label: "S-U · 基础理解", value: "S-U" },
  { label: "M-U · 综合理解", value: "M-U" },
  { label: "M-A · 综合应用", value: "M-A" },
  { label: "C-A · 复杂应用", value: "C-A" },
];

const MODES: Array<{ label: string; value: ReviewMode }> = [
  { label: "练习 · 直接答题", value: "practice" },
  { label: "卡片练习 · 先回忆概念", value: "card_practice" },
  { label: "章节学习 · 结合章节材料", value: "chapter_study" },
];

const QUESTION_TYPES: Array<{ label: string; value: QuestionType }> = [
  { label: "简答题", value: "short_answer" },
  { label: "单选题", value: "choice" },
  { label: "判断题", value: "judgment" },
];

function selectedValue<T>(label: string | undefined, options: Array<{ label: string; value: T }>): T | undefined {
  return options.find((option) => option.label === label)?.value;
}

function requireSuccessfulGraph(result: GraphRunResult): Record<string, unknown> {
  if (result.status !== "ok") {
    const reason = typeof result.result.reason === "string" ? `：${result.result.reason}` : "";
    throw new Error(`图 ${result.graphId} 未正常完成（${result.status}）${reason}`);
  }
  return result.result;
}

function harderDifficulty(current: DifficultyLevel): DifficultyLevel {
  const values = DIFFICULTIES.map((option) => option.value);
  return values[Math.min(values.indexOf(current) + 1, values.length - 1)] ?? current;
}

function questionViewType(type: QuestionType): QuestionViewType {
  if (type === "multi_choice") throw new Error("当前学习界面尚未开放多选题");
  return type;
}

export default async function studyHelperExtension(pi: ExtensionAPI): Promise<void> {
  const dataRoot = resolveStudyDataRoot();
  const traceDirectory = resolve(dataRoot, "traces");
  await mkdir(traceDirectory, { recursive: true });
  const tracePath = resolve(traceDirectory, "loop-graph-lifecycle.jsonl");

  const profiles = new ProfileFamilyRepository({ dataRoot });
  const memory = new PrivateMemoryRepository({ dataRoot });
  const graphs = createStudyWalkingSkeletonGraphs(profiles);
  const traceSink = createJsonlTraceSink(tracePath);

  pi.registerCommand("study", {
    description: "启动一次任务驱动学习会话",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("当前 Agent 仍在工作，请稍后再开始学习。", "warning");
        return;
      }

      let batchId: string | undefined;
      let session: StudySession | undefined;
      const tui = new StudyTuiGateway(ctx.ui);
      ctx.ui.setStatus("pi-study-helper", "正在准备学习会话…");
      try {
        const executeGraph = createIsolatedGraphExecutor(ctx, {
          traceSink,
          limits: { rootMaxSteps: 10, agentRunTimeoutMs: 300_000 },
        });
        await profiles.seedDemoProfile();
        const activeProfiles = await profiles.listActiveProfiles();
        if (activeProfiles.length === 0) {
          ctx.ui.notify("还没有可学习的 active 资料包。", "warning");
          return;
        }

        const requestedSubjectId = args.trim();
        let subjectId = activeProfiles.find((profile) => profile.subjectId === requestedSubjectId)?.subjectId;
        if (!subjectId) {
          const labels = activeProfiles.map((profile) => `${profile.name} · ${profile.subjectId}`);
          const selected = await ctx.ui.select("选择学习资料包", labels);
          if (!selected) return;
          subjectId = activeProfiles[labels.indexOf(selected)]?.subjectId;
        }
        if (!subjectId) return;

        const scopes = await listStudyScopes(profiles, subjectId);
        if (scopes.length === 0) throw new Error("active 资料包没有可学习章节");
        const scopeLabel = await ctx.ui.select("选择范围", scopes.map((scope) => scope.label));
        let currentScope = scopes.find((item) => item.label === scopeLabel);
        if (!currentScope) return;

        const modeLabel = await ctx.ui.select("选择学习方式", MODES.map((option) => option.label));
        const mode = selectedValue(modeLabel, MODES);
        if (!mode) return;
        const difficultyLabel = await ctx.ui.select("选择难度", DIFFICULTIES.map((option) => option.label));
        let currentDifficulty = selectedValue(difficultyLabel, DIFFICULTIES);
        if (!currentDifficulty) return;
        const questionTypeLabel = await ctx.ui.select("选择题型", QUESTION_TYPES.map((option) => option.label));
        const questionType = selectedValue(questionTypeLabel, QUESTION_TYPES);
        if (!questionType) return;

        const startedAt = new Date().toISOString();
        session = {
          sessionId: crypto.randomUUID(),
          subjectId,
          status: "running",
          mode,
          scope: currentScope.label,
          totalQuestions: 0,
          correct: 0,
          incorrect: 0,
          createdAt: startedAt,
          updatedAt: startedAt,
        };
        const batch = await memory.createPendingBatch(session);
        batchId = batch.batchId;

        const attempts: Attempt[] = [];
        let shouldEnd = false;
        while (!shouldEnd) {
          ctx.ui.setStatus("pi-study-helper", "正在依据资料生成题目…");
          const generated = asReviewQuestion(requireSuccessfulGraph(await executeGraph(
            graphs.generateQuestion,
            {
              subjectId,
              scopeId: currentScope.id,
              difficulty: currentDifficulty,
              questionType,
              mode,
            },
          )));
          const question = { ...generated, question_id: crypto.randomUUID() };
          const answerHistory: NonNullable<Attempt["answer_history"]> = [];
          const clarifiedPoints: string[] = [];
          const lingeringQuestions: string[] = [];
          let finalAnswer = "";
          let grade: GradeResult | undefined;
          let outcome: Attempt["outcome"] | undefined;

          const discuss = async (lastGrade: GradeResult | undefined, revealAnswer: boolean): Promise<void> => {
            const userMessage = await ctx.ui.input("你想讨论什么？", "输入对题目、答案或解析的疑问");
            if (userMessage === undefined || userMessage.trim() === "") return;
            ctx.ui.setStatus("pi-study-helper", "正在讨论这道题…");
            const discussionInput = buildDiscussionAgentInput(
              question,
              lastGrade,
              finalAnswer,
              userMessage,
              revealAnswer,
            );
            const discussionRun = await executeOptionalDiscussion(
              executeGraph,
              graphs.discussQuestion,
              discussionInput,
            );
            if (discussionRun.status === "unavailable") {
              ctx.ui.notify("讨论暂时没有生成可用回复，请继续作答或稍后重试。", "warning");
              return;
            }
            const discussion = discussionRun.result;
            const reply = String(discussion.reply ?? "").trim();
            if (reply) ctx.ui.notify(reply, "info");
            if (Array.isArray(discussion.clarified_points)) {
              clarifiedPoints.push(...discussion.clarified_points.filter((item): item is string => typeof item === "string"));
            }
            if (Array.isArray(discussion.lingering_questions)) {
              lingeringQuestions.push(...discussion.lingering_questions.filter((item): item is string => typeof item === "string"));
            }
          };

          const baseQuestionView: QuestionViewModel = {
            questionId: question.question_id,
            questionNumber: session.totalQuestions + 1,
            scope: currentScope.label,
            mode,
            difficulty: difficultyFrom(question.difficulty ?? currentDifficulty),
            type: questionViewType(question.type),
            questionText: question.question_text,
            options: question.options,
            phase: "first_attempt",
            attemptNumber: 1,
          };

          let currentQuestionView = baseQuestionView;
          while (!grade?.is_correct) {
            ctx.ui.setStatus(
              "pi-study-helper",
              currentQuestionView.phase === "revision" ? "等待订正答案…" : "等待作答…",
            );
            const answerAction = await tui.collectAnswer(currentQuestionView);
            if (answerAction.kind === "cancelled") throw new Error("用户取消了答题输入");
            if (answerAction.kind === "gave_up") {
              outcome = "gave_up";
              grade = {
                is_correct: false,
                correct_answer: question.correct_answer ?? "请查看解析",
                explanation_l1: question.explanation_l1 ?? "本题已放弃。",
                knowledge_chain_l3: question.related_knowledge_chain ?? [],
                suggestion_next: "阅读解析并完成题目消化",
                grading: "用户通过明确操作放弃本题。",
              };
              break;
            }
            finalAnswer = answerAction.answer;
            ctx.ui.setStatus("pi-study-helper", "正在检查答案…");
            grade = asGradeResult(requireSuccessfulGraph(await executeGraph(
              graphs.gradeAnswer,
              { question, userAnswer: finalAnswer },
            )));
            answerHistory.push({
              answer: finalAnswer,
              is_correct: grade.is_correct,
              grading: grade.grading,
              timestamp: new Date().toISOString(),
            });
            if (grade.is_correct) {
              outcome = "correct";
              break;
            }
            ctx.ui.notify("回答尚未完全正确。你可以再次作答、讨论这道题，或明确放弃并查看解析。", "warning");
            const retryAction = await ctx.ui.select("接下来怎么做？", ["再次作答", "讨论这道题", "放弃并看解析"]);
            if (!retryAction) throw new Error("用户取消了答题流程");
            if (retryAction === "讨论这道题") await discuss(grade, false);
            if (retryAction === "放弃并看解析") {
              outcome = "gave_up";
              grade = { ...grade, is_correct: false, grading: `${grade.grading}\n用户随后通过明确操作选择放弃。` };
              break;
            }
            currentQuestionView = {
              ...baseQuestionView,
              phase: "revision",
              attemptNumber: answerHistory.length + 1,
            };
            tui.updateRevision(currentQuestionView);
          }
          if (!grade || !outcome) throw new Error("题目没有形成确定的业务结果");

          const attempt: Attempt = {
            question_id: question.question_id,
            session_id: session.sessionId,
            knowledge_points: question.knowledge_points ?? [],
            difficulty: difficultyFrom(question.difficulty ?? currentDifficulty),
            type: question.type,
            timestamp: new Date().toISOString(),
            question_text: question.question_text,
            options: question.options,
            user_answer: finalAnswer,
            answer_history: answerHistory,
            correct_answer: grade.correct_answer,
            explanation_l1: grade.explanation_l1,
            source_basis: question.source_basis ?? "active Profile",
            outcome,
            is_correct: grade.is_correct,
            knowledge_chain_l3: grade.knowledge_chain_l3,
            suggestion_next: grade.suggestion_next,
          };
          await memory.saveAttempt(subjectId, batchId, attempt);
          session = {
            ...session,
            scope: currentScope.label,
            totalQuestions: session.totalQuestions + 1,
            correct: session.correct + (grade.is_correct ? 1 : 0),
            incorrect: session.incorrect + (grade.is_correct ? 0 : 1),
            updatedAt: new Date().toISOString(),
          };
          await memory.saveRunningSession(subjectId, batchId, session);
          attempts.push(attempt);
          ctx.ui.notify(
            `${grade.is_correct ? "回答正确" : "本题已结束"}\n\n解析：${grade.explanation_l1}\n\n建议：${grade.suggestion_next}`,
            grade.is_correct ? "info" : "warning",
          );

          while (true) {
            const digestAction = await ctx.ui.select("题目消化", ["已理解，进入功能菜单", "继续讨论这道题"]);
            if (!digestAction) throw new Error("用户取消了题目消化流程");
            if (digestAction === "已理解，进入功能菜单") break;
            await discuss(grade, true);
          }
          tui.clearQuestion();

          if (clarifiedPoints.length > 0 || lingeringQuestions.length > 0) {
            attempt.discussion_summary = {
              core_misconception: grade.is_correct ? "" : grade.grading,
              clarified_points: clarifiedPoints,
              user_self_correction: grade.is_correct && answerHistory.length > 1 ? finalAnswer : null,
              lingering_questions: lingeringQuestions,
            };
            await memory.saveAttempt(subjectId, batchId, attempt);
          }

          let nextQuestion = false;
          while (!nextQuestion && !shouldEnd) {
            const action = await ctx.ui.select("学习功能", [
              "下一题",
              "提高难度",
              "更换章节/知识点",
              "查看当前范围材料",
              "查看当前学习总结",
              "结束并保存总结",
            ]);
            if (!action) throw new Error("用户取消了学习功能菜单");
            if (action === "下一题") nextQuestion = true;
            if (action === "提高难度") {
              const next = harderDifficulty(currentDifficulty);
              if (next === currentDifficulty) ctx.ui.notify("当前已经是最高难度。", "info");
              else {
                currentDifficulty = next;
                ctx.ui.notify(`难度已提高到 ${currentDifficulty}。`, "info");
              }
              nextQuestion = true;
            }
            if (action === "更换章节/知识点") {
              const changedLabel = await ctx.ui.select("选择新范围", scopes.map((item) => item.label));
              const changed = scopes.find((item) => item.label === changedLabel);
              if (changed) {
                currentScope = changed;
                session = { ...session, scope: changed.label, updatedAt: new Date().toISOString() };
                nextQuestion = true;
              }
            }
            if (action === "查看当前范围材料") {
              const context = await loadActiveStudyContext(profiles, subjectId, currentScope.id, 8_000);
              ctx.ui.notify(context.material, "info");
            }
            if (action === "查看当前学习总结") {
              ctx.ui.setStatus("pi-study-helper", "正在生成当前学习总结…");
              const interim = requireSuccessfulGraph(await executeGraph(
                graphs.summarizeSession,
                { session, attempts },
              ));
              ctx.ui.notify(String(interim.summary_markdown ?? "暂无总结"), "info");
            }
            if (action === "结束并保存总结") shouldEnd = true;
          }
        }

        ctx.ui.setStatus("pi-study-helper", "正在生成本次学习情况总结…");
        const summaryResult = requireSuccessfulGraph(await executeGraph(
          graphs.summarizeSession,
          { session, attempts },
        ));
        const summaryMarkdown = String(summaryResult.summary_markdown ?? "").trim();
        if (!summaryMarkdown) throw new Error("总结节点没有生成可保存的学习情况总结");

        const endedAt = new Date().toISOString();
        const completedSession: StudySession = { ...session, status: "completed", updatedAt: endedAt, endedAt };
        await memory.completeSession(subjectId, batchId, completedSession, `${summaryMarkdown}\n`);
        session = completedSession;
        ctx.ui.notify(`学习会话已完成并保存总结。\n\n${summaryMarkdown}`, "info");
      } catch (error) {
        if (session && batchId && session.status === "running") {
          const endedAt = new Date().toISOString();
          session = { ...session, status: "interrupted", updatedAt: endedAt, endedAt };
          try {
            await memory.interruptSession(session.subjectId, batchId, session);
          } catch {
            // 原始错误更重要；中断持久化失败由下一次 doctor 检查暴露。
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`学习会话未正常完成：${message}`, "error");
      } finally {
        tui.clearQuestion();
        ctx.ui.setStatus("pi-study-helper", undefined);
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      await profiles.seedDemoProfile();
      ctx.ui.notify("Pi Study Helper 已加载；使用 /study 开始学习。", "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Pi Study Helper 已加载，但 demo 初始化失败：${message}`, "warning");
    }
  });
}
