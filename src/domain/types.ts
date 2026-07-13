// ============================================================
//  Pi Study Helper — 核心领域类型
// ============================================================
//
//  本文件是里程碑 1 walking skeleton 使用的领域类型草稿，与 SDK Graph
//  类型和 pi 宿主类型正交。正式字段语义将在阶段 2 的 schema 设计中确定；
//  在此之前不得把这些字段当作已发布兼容契约。
// ============================================================

// ── Profile（学习资料包）──

/** 资料包状态（与所在 slot 必须一致） */
export type ProfileStatus = "draft" | "active";

/** 资料包位置 */
export type ProfileSlot = ProfileStatus;

/** canonical Profile 内部路径 */
export interface ProfilePaths {
  subject: string;
  knowledgeIndex: string;
  cards: string;
  chapters: string;
  examPoints: string;
  sourceMap: string;
  qualityReport: string;
}

/** 学习资料包 */
export interface Profile {
  /** 科目标识（URL-safe） */
  subjectId: string;
  /** 时间戳版本标识 */
  version: string;
  /** 单调递增修订号 */
  revision: number;
  /** 资料包状态：draft 不可用于学习，active 可用 */
  status: ProfileStatus;
  /** 所在 family slot */
  slot: ProfileSlot;
  /** 科目名称（可读） */
  name: string;
  /** canonical 内容路径 */
  paths: ProfilePaths;
  /** 修订来源版本（仅 revision draft 有值） */
  revisionOf?: string;
  /** 创建时间 ISO-8601 */
  createdAt: string;
  /** 最后修改时间 ISO-8601 */
  updatedAt: string;
}

// ── Session（学习会话）──

/** 会话状态 */
export type SessionStatus = "running" | "completed" | "interrupted";

/** 学习会话 */
export interface StudySession {
  /** 会话唯一标识 */
  sessionId: string;
  /** 关联的 subjectId */
  subjectId: string;
  /** 会话状态 */
  status: SessionStatus;
  /** 复习模式 */
  mode: ReviewMode;
  /** 复习范围 */
  scope: string;
  /** 本次会话实际进入过的范围，按进入顺序保存。 */
  scopeHistory: Array<{
    scopeId: string;
    scopeLabel: string;
    enteredAt: string;
  }>;
  /** 已做题数 */
  totalQuestions: number;
  /** 正确数 */
  correct: number;
  /** 错误数 */
  incorrect: number;
  /** 创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 结束时间（completed/interrupted 时写入） */
  endedAt?: string;
}

/** 复习模式 */
export type ReviewMode = "card_practice" | "practice" | "chapter_study";

// ── Question（题目）──

/** 题目类型 */
export type QuestionType = "choice" | "multi_choice" | "judgment" | "short_answer";

/** 难度等级 */
export type DifficultyLevel = "S-R" | "S-U" | "M-U" | "M-A" | "C-A";

/** 结构化复习题 */
export interface ReviewQuestion {
  question_id?: string;
  knowledge_points?: string[];
  difficulty?: DifficultyLevel;
  type: QuestionType;
  question_text: string;
  options?: string[];
  correct_answer?: string;
  explanation_l1?: string;
  source_basis?: string;
  related_knowledge_chain?: string[];
}

// ── Attempt（答题记录）──

/** 单次答题记录 */
export interface Attempt {
  question_id: string;
  session_id: string;
  scope_id: string;
  scope_label: string;
  target_kind: "scope" | "card" | "section";
  target_id: string;
  target_label: string;
  knowledge_points: string[];
  difficulty: DifficultyLevel;
  type: QuestionType;
  timestamp: string;
  question_text: string;
  options?: string[];
  user_answer: string;
  /** 同一道题在完成前的全部提交，保留纠错过程 */
  answer_history?: Array<{
    answer: string;
    is_correct: boolean;
    grading: string;
    timestamp: string;
  }>;
  correct_answer: string;
  explanation_l1: string;
  source_basis: string;
  /** 本题的确定性业务结果；只有代码识别到明确放弃动作时才是 gave_up。 */
  outcome: "correct" | "gave_up";
  is_correct: boolean;
  discussion_summary?: DiscussionSummary;
  knowledge_chain_l3: string[];
  suggestion_next: string;
}

/** 讨论摘要 */
export interface DiscussionSummary {
  core_misconception: string;
  clarified_points: string[];
  user_self_correction: string | null;
  lingering_questions: string[];
}

// ── Grade（判题结果）──

/** 判题结果 */
export interface GradeResult {
  is_correct: boolean;
  correct_answer: string;
  explanation_l1: string;
  knowledge_chain_l3: string[];
  suggestion_next: string;
  grading: string;
}

// ── Summary（会话总结）──

/** 会话总结 */
export interface SessionSummary {
  session_id: string;
  subject_id: string;
  report: string;
  scope: string;
  total_questions: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  weak_points: string[];
  strengths: string[];
  recommendations: string[];
  created_at: string;
}

// ── Learning Profile（学习画像）──

/** 长期学习画像 */
export interface LearningProfile {
  subject_id: string;
  updated_at: string;
  total_questions: number;
  total_correct: number;
  accuracy: number;
  profile_summary: string;
  weak_points: string[];
  strengths: string[];
  unverified_topics: string[];
  recommendations: string[];
  recent_sessions: string[];
}

/** 一次学习会话在私有学习记忆中的记录批次 */
export interface LearningRecordBatch {
  batchId: string;
  subjectId: string;
  sessionId: string;
  directory: string;
}

// ── 代码侧业务能力接口 ──

/** 提供给图代码节点和 TUI handler 的会话级服务集合 */
export interface StudySessionServices {
  /** 读取 Profile */
  loadProfile(subjectId: string): Profile;
  /** 管理会话生命周期 */
  initSession(scope: string, knowledgePointIds: string[]): StudySession;
  endSession(sessionId: string, status: SessionStatus): void;
  loadSession(sessionId: string): StudySession | null;
  /** 归档答题记录 */
  archiveAttempt(attempt: Attempt): void;
  /** 保存会话总结 */
  saveSummary(summary: SessionSummary): void;
  /** 读取学习画像 */
  loadLearningProfile(subjectId: string): LearningProfile;
}

// ── 图节点输入/输出类型 ──

/** prepare_session 节点输出 */
export interface PrepareSessionResult {
  sessionId: string;
  subjectId: string;
  mode: ReviewMode;
  scope: string;
  chapterId?: string;
  knowledgePointId?: string;
  difficulty?: DifficultyLevel;
  questionType?: QuestionType;
}

/** present_material 节点输出 */
export interface PresentMaterialResult {
  materialShown: boolean;
  materialType: "card" | "exam_points" | "chapter";
  materialRef: string;
}

/** persist_attempt 节点输出 */
export interface PersistAttemptResult {
  questionId: string;
  archived: boolean;
}

/** choose_action 节点输出 */
export interface ChooseActionResult {
  action: "next_question" | "show_material" | "discuss" | "summary" | "exit";
  context?: Record<string, unknown>;
}
