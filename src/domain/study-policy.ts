import type { DifficultyLevel, ReviewMode } from "./types.js";

/** 由代码维护的难度语义。Agent 不得自行猜测难度缩写。 */
export interface DifficultyPolicy {
  readonly level: DifficultyLevel;
  readonly label: string;
  readonly learningGoal: string;
  readonly questionConstraints: readonly string[];
}

/** 不同学习方式的确定性产品策略。 */
export interface ReviewModePolicy {
  readonly mode: ReviewMode;
  readonly label: string;
  readonly entryBehavior: string;
  readonly questionConstraints: readonly string[];
  readonly answerGuidance: {
    readonly style: string;
    readonly recommendedLength: string;
  };
}

export const DIFFICULTY_POLICIES: Readonly<Record<DifficultyLevel, DifficultyPolicy>> = {
  "S-R": {
    level: "S-R",
    label: "简单·识记",
    learningGoal: "准确回忆资料中的单个事实、术语、定义或直接对应关系。",
    questionConstraints: [
      "只考查一个明确知识点，不组合多个推理步骤。",
      "答案必须能从资料原文直接定位，不要求迁移或开放发挥。",
      "避免否定套否定、相似选项陷阱和超出资料的背景知识。",
    ],
  },
  "S-U": {
    level: "S-U",
    label: "简单·理解",
    learningGoal: "用自己的话说明一个概念、机制、区别或直接因果关系。",
    questionConstraints: [
      "围绕一个主要知识点，可要求解释、举例或比较一个直接差异。",
      "作答最多需要一个推理步骤，资料中必须有充分依据。",
      "不引入跨章节综合、复杂情境或资料外专业术语。",
    ],
  },
  "M-U": {
    level: "M-U",
    label: "中等·理解",
    learningGoal: "联系同一范围内的多个信息，解释关系并识别常见误区。",
    questionConstraints: [
      "组合两个或三个相关知识点，要求比较、归因或辨析。",
      "需要一到两个清晰推理步骤，但结论仍由所选资料范围支持。",
      "错误选项或设问可包含常见误区，但不得依赖文字游戏。",
    ],
  },
  "M-A": {
    level: "M-A",
    label: "中等·应用",
    learningGoal: "把资料中的规则或方法应用到一个新的、边界明确的情境。",
    questionConstraints: [
      "提供具体情境，要求选择方法、作出判断或提出可执行方案。",
      "需要至少两个推理步骤，并要求说明所用资料依据。",
      "情境信息必须充分且无歧义，不得靠资料外常识决定答案。",
    ],
  },
  "C-A": {
    level: "C-A",
    label: "复杂·应用",
    learningGoal: "综合多个知识点处理有约束的复杂情境，并权衡方案或诊断问题。",
    questionConstraints: [
      "综合至少三个相关知识点或跨小节关系。",
      "要求多步推理、权衡约束，并解释为什么排除替代方案。",
      "问题必须有可验证的核心答案和评分依据，不能变成无边界讨论。",
    ],
  },
};

export const REVIEW_MODE_POLICIES: Readonly<Record<ReviewMode, ReviewModePolicy>> = {
  practice: {
    mode: "practice",
    label: "直接练习",
    entryBehavior: "选定范围后直接进入题目，不预先展示答案或完整学习材料。",
    questionConstraints: [
      "以检索和应用为主，题目可覆盖所选范围内任意有效知识点。",
      "题目必须独立完整，不假设用户刚刚阅读过某张卡片或章节正文。",
    ],
    answerGuidance: {
      style: "直接回答核心结论，并用必要依据说明判断。",
      recommendedLength: "选择/判断题给出选项；简答题建议 2—5 句。",
    },
  },
  card_practice: {
    mode: "card_practice",
    label: "卡片回忆",
    entryBehavior: "先展示卡片正面的提示或问题，再要求快速回忆；作答前不展示卡片背面。",
    questionConstraints: [
      "每题聚焦一张卡片的一个最小知识单元，优先短答、判断或单选。",
      "题干应短且直接，不扩展成长情境题或跨卡片综合题。",
    ],
    answerGuidance: {
      style: "先凭记忆给出关键词或一句核心结论，不追求展开论述。",
      recommendedLength: "关键词、单个选项或 1—2 句；通常不超过 80 个汉字。",
    },
  },
  chapter_study: {
    mode: "chapter_study",
    label: "章节学习",
    entryBehavior: "先展示所选章节的学习材料和学习目标，确认阅读后再进入理解与应用题。",
    questionConstraints: [
      "题目必须基于刚展示的章节材料，并标明涉及的章节知识点。",
      "优先考查概念关系、章节结构和应用；可随进度从理解逐步过渡到综合。",
    ],
    answerGuidance: {
      style: "结合章节内容组织完整回答，说明概念关系或推理过程。",
      recommendedLength: "简答题建议 3—8 句；复杂应用题可分点作答。",
    },
  },
};

/** 获取固定难度策略；外部输入不在支持列表时立即失败。 */
export function getDifficultyPolicy(level: string): DifficultyPolicy {
  if (!Object.hasOwn(DIFFICULTY_POLICIES, level)) {
    throw new RangeError(`不支持的难度等级：${level}`);
  }
  return DIFFICULTY_POLICIES[level as DifficultyLevel];
}

/** 获取固定学习方式策略；外部输入不在支持列表时立即失败。 */
export function getReviewModePolicy(mode: string): ReviewModePolicy {
  if (!Object.hasOwn(REVIEW_MODE_POLICIES, mode)) {
    throw new RangeError(`不支持的学习方式：${mode}`);
  }
  return REVIEW_MODE_POLICIES[mode as ReviewMode];
}
