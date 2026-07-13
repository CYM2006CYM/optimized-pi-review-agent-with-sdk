import { describe, expect, it, vi } from "vitest";
import {
  StudyTuiGateway,
  renderQuestionWidget,
  type QuestionViewModel,
  type StudyUiPort,
} from "../src/tui/study-tui-gateway.js";

const SECRET_ANSWER = "SECRET-CORRECT-ANSWER";
const SECRET_EXPLANATION = "SECRET-EXPLANATION";
const SECRET_SOURCE = "SECRET-SOURCE-BASIS";

function question(overrides: Partial<QuestionViewModel> = {}): QuestionViewModel {
  return {
    questionId: "question-1",
    questionNumber: 1,
    totalQuestions: 3,
    scope: "第一章",
    mode: "practice",
    difficulty: "S-U",
    type: "short_answer",
    questionText: "主动回忆与重复阅读有什么区别？",
    phase: "first_attempt",
    attemptNumber: 1,
    ...overrides,
  };
}

function createUi(options: {
  inputs?: Array<string | undefined>;
  selections?: Array<string | undefined>;
} = {}) {
  const widgetCalls: Array<{ key: string; content: string[] | undefined }> = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];
  const selectCalls: Array<{ title: string; options: string[] }> = [];
  const inputs = [...(options.inputs ?? [])];
  const selections = [...(options.selections ?? [])];
  const ui: StudyUiPort = {
    setWidget(key, content) {
      widgetCalls.push({ key, content });
    },
    input: vi.fn(async (title: string, placeholder?: string) => {
      inputCalls.push({ title, placeholder });
      return inputs.shift();
    }),
    select: vi.fn(async (title: string, choices: string[]) => {
      selectCalls.push({ title, options: choices });
      return selections.shift();
    }),
  };
  return { ui, widgetCalls, inputCalls, selectCalls };
}

function allVisibleUiText(recording: ReturnType<typeof createUi>): string {
  return [
    ...recording.widgetCalls.flatMap((call) => call.content ?? []),
    ...recording.inputCalls.flatMap((call) => [call.title, call.placeholder ?? ""]),
    ...recording.selectCalls.flatMap((call) => [call.title, ...call.options]),
  ].join("\n");
}

describe("StudyTuiGateway", () => {
  it("只从白名单字段构造界面，不会展示答案、解析或来源", async () => {
    const recording = createUi({ inputs: ["我的答案"] });
    const gateway = new StudyTuiGateway(recording.ui);
    const runtimeQuestion = {
      ...question(),
      correct_answer: SECRET_ANSWER,
      explanation_l1: SECRET_EXPLANATION,
      source_basis: SECRET_SOURCE,
    } as QuestionViewModel;

    await gateway.collectAnswer(runtimeQuestion);

    const visible = allVisibleUiText(recording);
    expect(visible).toContain("主动回忆与重复阅读有什么区别？");
    expect(visible).not.toContain(SECRET_ANSWER);
    expect(visible).not.toContain(SECRET_EXPLANATION);
    expect(visible).not.toContain(SECRET_SOURCE);
  });

  it("题目 widget 始终不超过 Pi 的十行限制", () => {
    const lines = renderQuestionWidget(question({
      type: "choice",
      options: Array.from({ length: 12 }, (_, index) => `选项 ${index + 1}`),
    }));

    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines.join("\n")).toContain("L. 选项 12");
  });

  it("简答题去除首尾空白后提交答案", async () => {
    const recording = createUi({ inputs: ["  主动提取信息  "] });
    const gateway = new StudyTuiGateway(recording.ui);

    await expect(gateway.collectAnswer(question())).resolves.toEqual({
      kind: "submitted",
      answer: "主动提取信息",
    });
    expect(recording.widgetCalls[0]?.content?.join("\n")).toContain("首次作答");
  });

  it("只有明确输入 /giveup 才返回 gave_up", async () => {
    const recording = createUi({ inputs: [" /giveup "] });
    const gateway = new StudyTuiGateway(recording.ui);

    await expect(gateway.collectAnswer(question())).resolves.toEqual({ kind: "gave_up" });
  });

  it("选择题明确选择放弃才返回 gave_up", async () => {
    const recording = createUi({ selections: ["放弃本题"] });
    const gateway = new StudyTuiGateway(recording.ui);

    await expect(gateway.collectAnswer(question({
      type: "choice",
      options: ["主动回忆", "重复阅读"],
    }))).resolves.toEqual({ kind: "gave_up" });
    expect(recording.selectCalls[0]?.options).toEqual([
      "A. 主动回忆",
      "B. 重复阅读",
      "放弃本题",
    ]);
  });

  it("选择题返回规范选项文本，不把 UI 字母前缀写入答案", async () => {
    const recording = createUi({ selections: ["B. 重复阅读"] });
    const gateway = new StudyTuiGateway(recording.ui);

    await expect(gateway.collectAnswer(question({
      type: "choice",
      options: ["主动回忆", "重复阅读"],
    }))).resolves.toEqual({ kind: "submitted", answer: "重复阅读" });
  });

  it("判断题始终使用代码定义的正确和错误选项", async () => {
    const recording = createUi({ selections: ["A. 正确"] });
    const gateway = new StudyTuiGateway(recording.ui);

    await expect(gateway.collectAnswer(question({
      type: "judgment",
      options: ["模型自定义选项"],
    }))).resolves.toEqual({ kind: "submitted", answer: "正确" });
    expect(recording.selectCalls[0]?.options).toEqual(["A. 正确", "B. 错误", "放弃本题"]);
  });

  it("输入或选择被取消时返回 cancelled，不伪装成放弃", async () => {
    const inputRecording = createUi({ inputs: [undefined] });
    const selectRecording = createUi({ selections: [undefined] });

    await expect(new StudyTuiGateway(inputRecording.ui).collectAnswer(question()))
      .resolves.toEqual({ kind: "cancelled" });
    await expect(new StudyTuiGateway(selectRecording.ui).collectAnswer(question({
      type: "judgment",
    }))).resolves.toEqual({ kind: "cancelled" });
  });

  it("订正时更新持续展示的题目状态", () => {
    const recording = createUi();
    const gateway = new StudyTuiGateway(recording.ui);

    gateway.updateRevision(question({ attemptNumber: 2 }));

    expect(recording.widgetCalls).toHaveLength(1);
    expect(recording.widgetCalls[0]?.content?.join("\n")).toContain("订正第 2 次");
  });

  it("clear 会移除固定题目 widget", () => {
    const recording = createUi();
    const gateway = new StudyTuiGateway(recording.ui);

    gateway.presentQuestion(question());
    gateway.clearQuestion();

    expect(recording.widgetCalls.at(-1)).toEqual({
      key: "pi-study-helper.question",
      content: undefined,
    });
  });
});
