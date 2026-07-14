import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import { buildDiscussionAgentInput } from "./study-discussion.js";
import { executeOptionalDiscussion } from "./optional-discussion.js";
import { prepareMaterialForDisplay } from "../domain/material-display.js";
import { buildSessionEvidence } from "../domain/session-evidence.js";
import {
  listStudyScopes,
  loadActiveStudyTargetContext,
  type StudyScopeOption,
  type StudyTargetKind,
} from "../domain/study-profile.js";
import { DIFFICULTY_POLICIES } from "../domain/study-policy.js";
import type {
  Attempt,
  DifficultyLevel,
  GradeResult,
  QuestionType,
  ReviewMode,
  StudySession,
} from "../domain/types.js";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";
import {
  asGradeResult,
  asReviewQuestion,
  difficultyFrom,
  type StudyWalkingSkeletonGraphs,
} from "../graphs/study-walking-skeleton.js";
import type { PrivateMemoryRepository } from "../repositories/private-memory-repository.js";
import type { ProfileFamilyRepository } from "../repositories/profile-family-repository.js";
import {
  StudyTuiGateway,
  type MaterialTargetMetadata,
  type QuestionViewModel,
  type QuestionViewType,
  type StudyUiPort,
} from "../tui/study-tui-gateway.js";

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

const RECOVER_SUMMARY = "生成总结并结束";
const RECOVER_INTERRUPT = "标记为中断";
const RECOVER_CANCEL = "取消";

export interface StudyControllerUi extends StudyUiPort {
  notify(message: string, level?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
}

export interface StudySessionControllerDependencies {
  profiles: ProfileFamilyRepository;
  memory: PrivateMemoryRepository;
  graphs: StudyWalkingSkeletonGraphs;
  executeGraph: IsolatedGraphExecutor;
  ui: StudyControllerUi;
  now?: () => Date;
  createId?: () => string;
}

export type StudyRunResult =
  | { status: "cancelled" }
  | { status: "completed"; subjectId: string; batchId: string; session: StudySession }
  | { status: "interrupted"; subjectId: string; batchId: string; session: StudySession; error: string }
  | { status: "failed"; error: string };

export type StudyRecoveryResult =
  | { status: "none" | "cancelled" }
  | { status: "completed" | "interrupted"; subjectId: string; batchId: string }
  | { status: "failed"; subjectId?: string; batchId?: string; error: string };

interface SelectedStudyTarget extends MaterialTargetMetadata {
  kind: StudyTargetKind;
}

interface RecoveryCandidate {
  subjectId: string;
  subjectName: string;
  batchId: string;
  session: StudySession;
  attempts: Attempt[];
}

export function isRecoverableStudyBatch(batch: {
  session: Pick<StudySession, "status">;
  attempts: readonly Attempt[];
  summaryMarkdown?: string;
}): boolean {
  return batch.session.status === "running"
    || (batch.session.status === "interrupted"
      && batch.attempts.length > 0
      && !batch.summaryMarkdown?.trim());
}

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

async function executeSummaryWithRetry(
  executeGraph: IsolatedGraphExecutor,
  graph: Graph,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let lastResult: GraphRunResult | undefined;
  for (let completionAttempt = 1; completionAttempt <= 2; completionAttempt += 1) {
    lastResult = await executeGraph(graph, { ...params, completionAttempt });
    if (lastResult.status === "ok") return lastResult.result;
    if (lastResult.status !== "failed") break;
  }
  if (!lastResult) throw new Error("总结图没有启动");
  return requireSuccessfulGraph(lastResult);
}

function harderDifficulty(current: DifficultyLevel): DifficultyLevel {
  const values = DIFFICULTIES.map((option) => option.value);
  return values[Math.min(values.indexOf(current) + 1, values.length - 1)] ?? current;
}

function questionViewType(type: QuestionType): QuestionViewType {
  if (type === "multi_choice") throw new Error("当前学习界面尚未开放多选题");
  return type;
}

function scopeTarget(scope: StudyScopeOption): SelectedStudyTarget {
  return { kind: "scope", id: scope.id, label: scope.label };
}

async function selectStudyTarget(
  ui: Pick<StudyUiPort, "select">,
  scope: StudyScopeOption,
  mode: ReviewMode,
): Promise<SelectedStudyTarget | undefined> {
  if (mode === "practice") return scopeTarget(scope);

  const candidates = mode === "card_practice" ? scope.cards : scope.sections;
  const targetLabel = mode === "card_practice" ? "卡片" : "小节";
  if (candidates.length === 0) throw new Error(`当前章节没有可用于${targetLabel}学习的资料`);

  const labels = candidates.map((candidate) => `${candidate.label} · ${candidate.id}`);
  const selected = await ui.select(`选择${targetLabel}`, labels);
  const index = labels.indexOf(selected ?? "");
  const candidate = candidates[index];
  if (!candidate) return undefined;
  return {
    kind: mode === "card_practice" ? "card" : "section",
    id: candidate.id,
    label: candidate.label,
    position: index + 1,
    total: candidates.length,
  };
}

function targetScopeLabel(scope: StudyScopeOption, target: SelectedStudyTarget): string {
  return target.kind === "scope" ? scope.label : `${scope.label} · ${target.label}`;
}

function changeTargetLabel(mode: ReviewMode): string {
  if (mode === "card_practice") return "更换卡片/章节";
  if (mode === "chapter_study") return "更换小节/章节";
  return "更换章节/知识点";
}

function recoveryLabel(candidate: RecoveryCandidate): string {
  const state = candidate.session.status === "interrupted" ? "待补总结" : "进行中";
  return `${candidate.subjectName} · ${state} · ${candidate.session.mode} · ${candidate.session.totalQuestions} 题 · ${candidate.batchId}`;
}

export class StudySessionController {
  private readonly profiles: ProfileFamilyRepository;
  private readonly memory: PrivateMemoryRepository;
  private readonly graphs: StudyWalkingSkeletonGraphs;
  private readonly executeGraph: IsolatedGraphExecutor;
  private readonly ui: StudyControllerUi;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(dependencies: StudySessionControllerDependencies) {
    this.profiles = dependencies.profiles;
    this.memory = dependencies.memory;
    this.graphs = dependencies.graphs;
    this.executeGraph = dependencies.executeGraph;
    this.ui = dependencies.ui;
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async recoveryCandidates(): Promise<RecoveryCandidate[]> {
    await this.profiles.seedDemoProfile();
    const activeProfiles = await this.profiles.listActiveProfiles();
    const candidates: RecoveryCandidate[] = [];
    for (const profile of activeProfiles) {
      const batches = await this.memory.listPendingBatches(profile.subjectId);
      for (const batch of batches) {
        if (!isRecoverableStudyBatch(batch)) continue;
        candidates.push({
          subjectId: profile.subjectId,
          subjectName: profile.name,
          batchId: batch.batchId,
          session: batch.session,
          attempts: batch.attempts,
        });
      }
    }
    return candidates;
  }

  async countRunningSessions(): Promise<number> {
    return (await this.recoveryCandidates()).filter((candidate) => candidate.session.status === "running").length;
  }

  async countRecoverableSessions(): Promise<number> {
    return (await this.recoveryCandidates()).length;
  }

  async recoverRunningSession(): Promise<StudyRecoveryResult> {
    this.ui.setStatus("pi-study-helper", "正在检查未完成学习会话…");
    let selectedCandidate: RecoveryCandidate | undefined;
    try {
      const candidates = await this.recoveryCandidates();
      if (candidates.length === 0) {
        this.ui.notify("没有需要处理的未完成学习会话。", "info");
        return { status: "none" };
      }
      const labels = candidates.map(recoveryLabel);
      const selected = await this.ui.select("选择未完成学习会话", labels);
      selectedCandidate = candidates[labels.indexOf(selected ?? "")];
      if (!selectedCandidate) return { status: "cancelled" };

      const actions = selectedCandidate.session.status === "interrupted"
        ? [RECOVER_SUMMARY, RECOVER_CANCEL]
        : selectedCandidate.attempts.length > 0
        ? [RECOVER_SUMMARY, RECOVER_INTERRUPT, RECOVER_CANCEL]
        : [RECOVER_INTERRUPT, RECOVER_CANCEL];
      const action = await this.ui.select("如何处理该会话？", actions);
      if (!action || action === RECOVER_CANCEL) return { status: "cancelled" };

      if (action === RECOVER_INTERRUPT) {
        const endedAt = this.nowIso();
        await this.memory.interruptSession(
          selectedCandidate.subjectId,
          selectedCandidate.batchId,
          { ...selectedCandidate.session, status: "interrupted", updatedAt: endedAt, endedAt },
        );
        this.ui.notify("未完成学习会话已标记为中断，已保存的题目记录保持不变。", "info");
        return {
          status: "interrupted",
          subjectId: selectedCandidate.subjectId,
          batchId: selectedCandidate.batchId,
        };
      }

      this.ui.setStatus("pi-study-helper", "正在为未完成会话补生成总结…");
      const summaryResult = await executeSummaryWithRetry(
        this.executeGraph,
        this.graphs.summarizeSession,
        {
          evidence: buildSessionEvidence(selectedCandidate.session, selectedCandidate.attempts),
          difficultyCatalog: DIFFICULTY_POLICIES,
          summaryKind: "recovery",
        },
      );
      const summaryMarkdown = String(summaryResult.summary_markdown ?? "").trim();
      if (!summaryMarkdown) throw new Error("总结节点没有生成可保存的学习情况总结");
      const endedAt = this.nowIso();
      await this.memory.completeSession(
        selectedCandidate.subjectId,
        selectedCandidate.batchId,
        { ...selectedCandidate.session, status: "completed", updatedAt: endedAt, endedAt },
        `${summaryMarkdown}\n`,
      );
      this.ui.notify(`未完成会话已补全并保存总结。\n\n${summaryMarkdown}`, "info");
      return {
        status: "completed",
        subjectId: selectedCandidate.subjectId,
        batchId: selectedCandidate.batchId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const preservedStatus = selectedCandidate?.session.status ?? "原有";
      this.ui.notify(`未完成会话处理失败：${message}。原记录保持 ${preservedStatus}，可稍后重试。`, "error");
      return {
        status: "failed",
        subjectId: selectedCandidate?.subjectId,
        batchId: selectedCandidate?.batchId,
        error: message,
      };
    } finally {
      this.ui.setStatus("pi-study-helper", undefined);
    }
  }

  async run(args: string): Promise<StudyRunResult> {
    let batchId: string | undefined;
    let session: StudySession | undefined;
    const tui = new StudyTuiGateway(this.ui);
    this.ui.setStatus("pi-study-helper", "正在准备学习会话…");
    try {
      await this.profiles.seedDemoProfile();
      const activeProfiles = await this.profiles.listActiveProfiles();
      if (activeProfiles.length === 0) {
        this.ui.notify("还没有可学习的 active 资料包。", "warning");
        return { status: "cancelled" };
      }

      const requestedSubjectId = args.trim();
      let subjectId = activeProfiles.find((profile) => profile.subjectId === requestedSubjectId)?.subjectId;
      if (!subjectId) {
        const labels = activeProfiles.map((profile) => `${profile.name} · ${profile.subjectId}`);
        const selected = await this.ui.select("选择学习资料包", labels);
        if (!selected) return { status: "cancelled" };
        subjectId = activeProfiles[labels.indexOf(selected)]?.subjectId;
      }
      if (!subjectId) return { status: "cancelled" };

      const scopes = await listStudyScopes(this.profiles, subjectId);
      if (scopes.length === 0) throw new Error("active 资料包没有可学习章节");
      const scopeLabel = await this.ui.select("选择范围", scopes.map((scope) => scope.label));
      let currentScope = scopes.find((item) => item.label === scopeLabel);
      if (!currentScope) return { status: "cancelled" };

      const modeLabel = await this.ui.select("选择学习方式", MODES.map((option) => option.label));
      const mode = selectedValue(modeLabel, MODES);
      if (!mode) return { status: "cancelled" };
      let currentTarget = await selectStudyTarget(this.ui, currentScope, mode);
      if (!currentTarget) return { status: "cancelled" };
      const difficultyLabel = await this.ui.select("选择难度", DIFFICULTIES.map((option) => option.label));
      let currentDifficulty = selectedValue(difficultyLabel, DIFFICULTIES);
      if (!currentDifficulty) return { status: "cancelled" };
      const questionTypeLabel = await this.ui.select("选择题型", QUESTION_TYPES.map((option) => option.label));
      const questionType = selectedValue(questionTypeLabel, QUESTION_TYPES);
      if (!questionType) return { status: "cancelled" };

      const startedAt = this.nowIso();
      session = {
        sessionId: this.createId(),
        subjectId,
        status: "running",
        mode,
        scope: currentScope.label,
        scopeHistory: [{ scopeId: currentScope.id, scopeLabel: currentScope.label, enteredAt: startedAt }],
        totalQuestions: 0,
        correct: 0,
        incorrect: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const batch = await this.memory.createPendingBatch(session);
      batchId = batch.batchId;

      const attempts: Attempt[] = [];
      let shouldEnd = false;
      let needsTargetGate = mode !== "practice";
      while (!shouldEnd) {
        if (needsTargetGate) {
          const context = await loadActiveStudyTargetContext(
            this.profiles,
            subjectId,
            currentScope.id,
            currentTarget.kind,
            currentTarget.id,
            12_000,
          );
          const materialView = {
            title: currentTarget.label,
            body: prepareMaterialForDisplay(context.material),
            target: currentTarget,
          };
          if (mode === "card_practice") {
            const recallAction = await tui.showRecallPrompt({
              title: currentTarget.label,
              target: { ...currentTarget, kind: "card" },
            });
            if (recallAction.kind === "cancelled") throw new Error("用户取消了卡片回忆");
            if (recallAction.kind === "view_material") {
              const materialAction = await tui.browseMaterial(materialView);
              if (materialAction.kind === "cancelled") throw new Error("用户取消了卡片材料浏览");
            }
          } else {
            const materialAction = await tui.browseMaterial(materialView);
            if (materialAction.kind === "cancelled") throw new Error("用户取消了章节材料浏览");
          }
          needsTargetGate = false;
        }

        this.ui.setStatus("pi-study-helper", "正在依据资料生成题目…");
        const generated = asReviewQuestion(requireSuccessfulGraph(await this.executeGraph(
          this.graphs.generateQuestion,
          {
            subjectId,
            scopeId: currentScope.id,
            targetKind: currentTarget.kind,
            targetId: currentTarget.id,
            difficulty: currentDifficulty,
            questionType,
            mode,
          },
        )));
        const question = { ...generated, question_id: this.createId() };
        const answerHistory: NonNullable<Attempt["answer_history"]> = [];
        const clarifiedPoints: string[] = [];
        const lingeringQuestions: string[] = [];
        let finalAnswer = "";
        let grade: GradeResult | undefined;
        let outcome: Attempt["outcome"] | undefined;

        const discuss = async (lastGrade: GradeResult | undefined, revealAnswer: boolean): Promise<void> => {
          const userMessage = await this.ui.input("你想讨论什么？", "输入对题目、答案或解析的疑问");
          if (userMessage === undefined || userMessage.trim() === "") return;
          this.ui.setStatus("pi-study-helper", "正在讨论这道题…");
          const discussionInput = buildDiscussionAgentInput(
            question,
            lastGrade,
            finalAnswer,
            userMessage,
            revealAnswer,
          );
          const discussionRun = await executeOptionalDiscussion(
            this.executeGraph,
            this.graphs.discussQuestion,
            discussionInput,
          );
          if (discussionRun.status === "unavailable") {
            this.ui.notify("讨论暂时没有生成可用回复，请继续作答或稍后重试。", "warning");
            return;
          }
          const discussion = discussionRun.result;
          const reply = String(discussion.reply ?? "").trim();
          if (reply) this.ui.notify(reply, "info");
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
          scope: targetScopeLabel(currentScope, currentTarget),
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
          this.ui.setStatus(
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
          this.ui.setStatus("pi-study-helper", "正在检查答案…");
          grade = asGradeResult(requireSuccessfulGraph(await this.executeGraph(
            this.graphs.gradeAnswer,
            { question, userAnswer: finalAnswer },
          )));
          answerHistory.push({
            answer: finalAnswer,
            is_correct: grade.is_correct,
            grading: grade.grading,
            timestamp: this.nowIso(),
          });
          if (grade.is_correct) {
            outcome = "correct";
            break;
          }
          this.ui.notify("回答尚未完全正确。你可以再次作答、讨论这道题，或明确放弃并查看解析。", "warning");
          const retryAction = await this.ui.select("接下来怎么做？", ["再次作答", "讨论这道题", "放弃并看解析"]);
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
          scope_id: currentScope.id,
          scope_label: currentScope.label,
          target_kind: currentTarget.kind,
          target_id: currentTarget.id,
          target_label: currentTarget.label,
          knowledge_points: question.knowledge_points ?? [],
          difficulty: difficultyFrom(question.difficulty ?? currentDifficulty),
          type: question.type,
          timestamp: this.nowIso(),
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
        await this.memory.saveAttempt(subjectId, batchId, attempt);
        session = {
          ...session,
          scope: currentScope.label,
          totalQuestions: session.totalQuestions + 1,
          correct: session.correct + (grade.is_correct ? 1 : 0),
          incorrect: session.incorrect + (grade.is_correct ? 0 : 1),
          updatedAt: this.nowIso(),
        };
        await this.memory.saveRunningSession(subjectId, batchId, session);
        attempts.push(attempt);
        this.ui.notify(
          `${grade.is_correct ? "回答正确" : "本题已结束"}\n\n解析：${grade.explanation_l1}\n\n建议：${grade.suggestion_next}`,
          grade.is_correct ? "info" : "warning",
        );

        while (true) {
          const digestAction = await this.ui.select("题目消化", ["已理解，进入功能菜单", "继续讨论这道题"]);
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
          await this.memory.saveAttempt(subjectId, batchId, attempt);
        }

        let nextQuestion = false;
        while (!nextQuestion && !shouldEnd) {
          const changeAction = changeTargetLabel(mode);
          const action = await this.ui.select("学习功能", [
            "下一题",
            "提高难度",
            changeAction,
            "查看当前目标材料",
            "查看当前学习总结",
            "结束并保存总结",
          ]);
          if (!action) throw new Error("用户取消了学习功能菜单");
          if (action === "下一题") nextQuestion = true;
          if (action === "提高难度") {
            const next = harderDifficulty(currentDifficulty);
            if (next === currentDifficulty) this.ui.notify("当前已经是最高难度。", "info");
            else {
              currentDifficulty = next;
              this.ui.notify(`难度已提高到 ${currentDifficulty}。`, "info");
            }
            nextQuestion = true;
          }
          if (action === changeAction) {
            const changedLabel = await this.ui.select("选择新范围", scopes.map((item) => item.label));
            const changed = scopes.find((item) => item.label === changedLabel);
            if (changed) {
              const changedTarget = await selectStudyTarget(this.ui, changed, mode);
              if (!changedTarget) continue;
              const enteredAt = this.nowIso();
              const scopeChanged = changed.id !== currentScope.id;
              currentScope = changed;
              currentTarget = changedTarget;
              session = {
                ...session,
                scope: changed.label,
                scopeHistory: scopeChanged
                  ? [...session.scopeHistory, { scopeId: changed.id, scopeLabel: changed.label, enteredAt }]
                  : session.scopeHistory,
                updatedAt: enteredAt,
              };
              await this.memory.saveRunningSession(subjectId, batchId, session);
              needsTargetGate = mode !== "practice";
              nextQuestion = true;
            }
          }
          if (action === "查看当前目标材料") {
            const context = await loadActiveStudyTargetContext(
              this.profiles,
              subjectId,
              currentScope.id,
              currentTarget.kind,
              currentTarget.id,
              12_000,
            );
            await tui.browseMaterial({
              title: currentTarget.label,
              body: prepareMaterialForDisplay(context.material),
              target: currentTarget,
            });
          }
          if (action === "查看当前学习总结") {
            this.ui.setStatus("pi-study-helper", "正在生成当前学习总结…");
            const interim = await executeSummaryWithRetry(
              this.executeGraph,
              this.graphs.summarizeSession,
              {
                evidence: buildSessionEvidence(session, attempts),
                difficultyCatalog: DIFFICULTY_POLICIES,
                summaryKind: "interim",
              },
            );
            this.ui.notify(String(interim.summary_markdown ?? "暂无总结"), "info");
          }
          if (action === "结束并保存总结") shouldEnd = true;
        }
      }

      this.ui.setStatus("pi-study-helper", "正在生成本次学习情况总结…");
      const summaryResult = await executeSummaryWithRetry(
        this.executeGraph,
        this.graphs.summarizeSession,
        {
          evidence: buildSessionEvidence(session, attempts),
          difficultyCatalog: DIFFICULTY_POLICIES,
          summaryKind: "final",
        },
      );
      const summaryMarkdown = String(summaryResult.summary_markdown ?? "").trim();
      if (!summaryMarkdown) throw new Error("总结节点没有生成可保存的学习情况总结");

      const endedAt = this.nowIso();
      const completedSession: StudySession = { ...session, status: "completed", updatedAt: endedAt, endedAt };
      await this.memory.completeSession(subjectId, batchId, completedSession, `${summaryMarkdown}\n`);
      session = completedSession;
      this.ui.notify(`学习会话已完成并保存总结。\n\n${summaryMarkdown}`, "info");
      return { status: "completed", subjectId, batchId, session };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (session && batchId && session.status === "running") {
        const endedAt = this.nowIso();
        session = { ...session, status: "interrupted", updatedAt: endedAt, endedAt };
        try {
          await this.memory.interruptSession(session.subjectId, batchId, session);
        } catch {
          // 原始错误更重要；遗留 running 会话由 /study-recover 处理。
        }
        this.ui.notify(`学习会话未正常完成：${message}`, "error");
        return { status: "interrupted", subjectId: session.subjectId, batchId, session, error: message };
      }
      this.ui.notify(`学习会话未正常完成：${message}`, "error");
      return { status: "failed", error: message };
    } finally {
      tui.clearQuestion();
      tui.clearMaterial();
      this.ui.setStatus("pi-study-helper", undefined);
    }
  }
}
