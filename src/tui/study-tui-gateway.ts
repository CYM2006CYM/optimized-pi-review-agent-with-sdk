import type { DifficultyLevel, ReviewMode } from "../domain/types.js";

const QUESTION_WIDGET_KEY = "pi-study-helper.question";
const MATERIAL_WIDGET_KEY = "pi-study-helper.material";
const GIVE_UP_OPTION = "放弃本题";
const MAX_WIDGET_LINES = 10;
const MATERIAL_HEADER_LINES = 4;
const MATERIAL_BODY_LINES = MAX_WIDGET_LINES - MATERIAL_HEADER_LINES;

const PREVIOUS_PAGE_OPTION = "上一页";
const NEXT_PAGE_OPTION = "下一页";
const START_PRACTICE_OPTION = "开始练习";
const CANCEL_OPTION = "取消";
const VIEW_MATERIAL_OPTION = "查看卡片正文";
const START_DIRECTLY_OPTION = "直接开始练习";

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

export type MaterialTargetKind = "card" | "section" | "scope";

/** Safe, presentation-only metadata for Profile material. */
export interface MaterialTargetMetadata {
  kind: MaterialTargetKind;
  id: string;
  label: string;
  position?: number;
  total?: number;
}

/**
 * Deliberately accepts Profile material only. Question, grade, answer and
 * explanation data do not belong in this boundary.
 */
export interface MaterialViewModel {
  title: string;
  body: string;
  target: MaterialTargetMetadata;
}

/** Card-front prompt shown before the card body is revealed. */
export interface RecallPromptViewModel {
  title: string;
  target: MaterialTargetMetadata & { kind: "card" };
}

export type MaterialViewAction = { kind: "start" } | { kind: "cancelled" };
export type RecallPromptAction =
  | { kind: "view_material" }
  | { kind: "start" }
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

function targetKindLabel(kind: MaterialTargetKind): string {
  if (kind === "card") return "卡片";
  if (kind === "section") return "小节";
  return "范围";
}

function singleLine(value: string): string {
  return value.replace(/\r\n?|\n/g, " ").replace(/\s+/g, " ").trim();
}

function targetProgress(target: MaterialTargetMetadata): string {
  if (target.position === undefined || target.total === undefined) return "";
  return ` · ${target.position}/${target.total}`;
}

/** Normalize newline variants and guarantee one widget row per array item. */
export function normalizeMaterialLines(body: string): string[] {
  const lines = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""));

  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  return lines.length > 0 ? lines : ["（暂无正文）"];
}

export function renderMaterialWidget(view: MaterialViewModel, pageIndex = 0): {
  lines: string[];
  pageIndex: number;
  pageCount: number;
} {
  const bodyLines = normalizeMaterialLines(view.body);
  const pageCount = Math.max(1, Math.ceil(bodyLines.length / MATERIAL_BODY_LINES));
  const safePageIndex = Math.min(Math.max(0, pageIndex), pageCount - 1);
  const start = safePageIndex * MATERIAL_BODY_LINES;
  const pageLines = bodyLines.slice(start, start + MATERIAL_BODY_LINES);
  const kind = targetKindLabel(view.target.kind);
  const title = singleLine(view.title) || singleLine(view.target.label);
  const targetLabel = singleLine(view.target.label);
  const targetId = singleLine(view.target.id);

  return {
    lines: [
      `【学习资料 · ${kind}${targetProgress(view.target)}】`,
      `标题：${title}`,
      `目标：${targetLabel} · ${targetId}`,
      `页码：${safePageIndex + 1}/${pageCount}`,
      ...pageLines,
    ],
    pageIndex: safePageIndex,
    pageCount,
  };
}

export function renderRecallPromptWidget(view: RecallPromptViewModel): string[] {
  const title = singleLine(view.title) || singleLine(view.target.label);
  const targetLabel = singleLine(view.target.label);
  const targetId = singleLine(view.target.id);
  return [
    `【卡片回忆${targetProgress(view.target)}】`,
    `卡片：${title}`,
    `目标：${targetLabel} · ${targetId}`,
    "先不要查看正文，回忆它的定义、关键要点和常见误区。",
  ];
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

  async showRecallPrompt(view: RecallPromptViewModel): Promise<RecallPromptAction> {
    this.ui.setWidget(
      MATERIAL_WIDGET_KEY,
      renderRecallPromptWidget(view),
      { placement: "aboveEditor" },
    );
    try {
      const selected = await this.ui.select("卡片回忆", [
        VIEW_MATERIAL_OPTION,
        START_DIRECTLY_OPTION,
        CANCEL_OPTION,
      ]);
      if (selected === VIEW_MATERIAL_OPTION) return { kind: "view_material" };
      if (selected === START_DIRECTLY_OPTION) return { kind: "start" };
      return { kind: "cancelled" };
    } finally {
      this.clearMaterial();
    }
  }

  async browseMaterial(view: MaterialViewModel): Promise<MaterialViewAction> {
    let pageIndex = 0;
    try {
      while (true) {
        const rendered = renderMaterialWidget(view, pageIndex);
        pageIndex = rendered.pageIndex;
        this.ui.setWidget(
          MATERIAL_WIDGET_KEY,
          rendered.lines,
          { placement: "aboveEditor" },
        );

        const options: string[] = [];
        if (pageIndex > 0) options.push(PREVIOUS_PAGE_OPTION);
        if (pageIndex < rendered.pageCount - 1) options.push(NEXT_PAGE_OPTION);
        options.push(START_PRACTICE_OPTION, CANCEL_OPTION);
        const selected = await this.ui.select("浏览学习资料", options);

        if (selected === PREVIOUS_PAGE_OPTION) {
          pageIndex -= 1;
          continue;
        }
        if (selected === NEXT_PAGE_OPTION) {
          pageIndex += 1;
          continue;
        }
        if (selected === START_PRACTICE_OPTION) return { kind: "start" };
        return { kind: "cancelled" };
      }
    } finally {
      this.clearMaterial();
    }
  }

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

  clearMaterial(): void {
    this.ui.setWidget(MATERIAL_WIDGET_KEY, undefined);
  }
}
