// ============================================================
//  Pi Study Helper — 核心领域类型
// ============================================================
//
//  本文件定义稳定的业务类型，与 SDK Graph 类型和 pi 宿主类型正交。
//  类型演进时优先添加新字段并标注 @since，不直接修改已发布字段语义。
// ============================================================

// ── Profile（学习资料包）──

/** 资料包状态 */
export type ProfileStatus = "draft" | "active";

/** 学习资料包 */
export interface Profile {
  /** 科目标识（URL-safe） */
  subjectId: string;
  /** 资料包版本 */
  version: number;
  /** 资料包状态：draft 不可用于学习，active 可用 */
  status: ProfileStatus;
  /** 科目名称（可读） */
  name: string;
  /** 资料包根目录 */
  root: string;
  /** 源资料目录 */
  sourceDir: string;
  /** 修订来源（仅 revision draft 有值） */
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
  knowledge_points: string[];
  difficulty: DifficultyLevel;
  type: QuestionType;
  timestamp: string;
  question_text: string;
  options?: string[];
  user_answer: string;
  correct_answer: string;
  explanation_l1: string;
  source_basis: string;
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
  weak_points: string[];
  strengths: string[];
  recent_sessions: string[];
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
