import type { DifficultyLevel, ReviewMode } from "../domain/types.js";

const QUESTION_WIDGET_KEY = "pi-study-helper.question";
const GIVE_UP_OPTION = "放弃本题";
const MAX_WIDGET_LINES = 10;

export type QuestionViewType = "short_answer" | "choice" | "judgment";
export type QuestionViewPhase = "first_attempt" | "revision";

/**
 * Deliberately contains presentation-only fields. In particular, answer,
 * explanation and source fields do not cross the TUI boundary.
 */
export interface QuestionViewModel {
  questionId: string;
  questionNumber: number;
  totalQuestions?: number;
  scope: string;
  mode: ReviewMode;
  difficulty: DifficultyLevel;
  type: QuestionViewType;
  questionText: string;
  options?: readonly string[];
  phase: QuestionViewPhase;
  attemptNumber: number;
}

export type AnswerAction =
  | { kind: "submitted"; answer: string }
  | { kind: "gave_up" }
  | { kind: "cancelled" };

/** The small subset of Pi UI used by the study flow and its test doubles. */
export interface StudyUiPort {
  setWidget(
    key: string,
    content: string[] | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  select(title: string, options: string[]): Promise<string | undefined>;
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function displayOptions(view: QuestionViewModel): readonly string[] {
  if (view.type === "judgment") return ["正确", "错误"];
  if (view.type === "choice" && (!view.options || view.options.length === 0)) {
    throw new Error("选择题必须提供选项");
  }
  return view.options ?? [];
}

function compactOptionLines(labels: readonly string[], maxLines: number): string[] {
  if (labels.length <= maxLines) return [...labels];

  const chunkSize = Math.ceil(labels.length / maxLines);
  const lines: string[] = [];
  for (let index = 0; index < labels.length; index += chunkSize) {
    lines.push(labels.slice(index, index + chunkSize).join("  |  "));
  }
  return lines;
}

export function renderQuestionWidget(view: QuestionViewModel): string[] {
  const state = view.phase === "revision"
    ? `订正第 ${Math.max(2, view.attemptNumber)} 次`
    : "首次作答";
  const progress = view.totalQuestions === undefined
    ? `第 ${view.questionNumber} 题`
    : `第 ${view.questionNumber}/${view.totalQuestions} 题`;
  const typeLabel = view.type === "short_answer"
    ? "简答题"
    : view.type === "choice"
      ? "单选题"
      : "判断题";
  const modeLabel = view.mode === "practice"
    ? "练习"
    : view.mode === "card_practice"
      ? "卡片练习"
      : "章节学习";
  const options = displayOptions(view);
  const optionLabels = options.map((option, index) => `${optionLetter(index)}. ${option}`);
  const fixedLines = [
    `【${progress} · ${state}】`,
    `范围：${view.scope}  |  方式：${modeLabel}  |  难度：${view.difficulty}  |  题型：${typeLabel}`,
    `题目：${view.questionText}`,
  ];
  const instruction = view.type === "short_answer"
    ? "请在下方输入答案；输入 /giveup 可放弃本题。"
    : "请在下方选择答案，或明确选择放弃本题。";
  const optionLines = compactOptionLines(optionLabels, MAX_WIDGET_LINES - fixedLines.length - 1);

  return [...fixedLines, ...optionLines, instruction];
}

export class StudyTuiGateway {
  constructor(private readonly ui: StudyUiPort) {}

  presentQuestion(view: QuestionViewModel): void {
    this.ui.setWidget(
      QUESTION_WIDGET_KEY,
      renderQuestionWidget(view),
      { placement: "aboveEditor" },
    );
  }

  updateRevision(view: QuestionViewModel): void {
    this.presentQuestion({
      ...view,
      phase: "revision",
      attemptNumber: Math.max(2, view.attemptNumber),
    });
  }

  async collectAnswer(view: QuestionViewModel): Promise<AnswerAction> {
    this.presentQuestion(view);

    if (view.type === "choice" || view.type === "judgment") {
      const options = displayOptions(view);
      const labels = options.map((option, index) => `${optionLetter(index)}. ${option}`);
      const selected = await this.ui.select(
        view.phase === "revision" ? "请选择订正后的答案" : "请选择答案",
        [...labels, GIVE_UP_OPTION],
      );
      if (selected === undefined) return { kind: "cancelled" };
      if (selected === GIVE_UP_OPTION) return { kind: "gave_up" };
      const selectedIndex = labels.indexOf(selected);
      if (selectedIndex < 0) throw new Error("选择结果不属于当前题目选项");
      return { kind: "submitted", answer: options[selectedIndex] ?? selected };
    }

    while (true) {
      const answer = await this.ui.input(
        view.phase === "revision" ? "请输入订正后的答案" : "请输入答案",
        "输入 /giveup 可放弃本题",
      );
      if (answer === undefined) return { kind: "cancelled" };
      const trimmed = answer.trim();
      if (trimmed === "/giveup") return { kind: "gave_up" };
      if (trimmed !== "") return { kind: "submitted", answer: trimmed };
    }
  }

  clearQuestion(): void {
    this.ui.setWidget(QUESTION_WIDGET_KEY, undefined);
  }
}
