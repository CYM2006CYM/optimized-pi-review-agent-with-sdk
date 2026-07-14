import type {
  Attempt,
  DifficultyLevel,
  QuestionType,
  ReviewMode,
  SessionStatus,
  StudySession,
} from "./types.js";

export const SESSION_EVIDENCE_LIMITS = {
  identifier: 160,
  timestamp: 64,
  scope: 120,
  questionExcerpt: 240,
  knowledgePoint: 80,
  knowledgePoints: 12,
  clarifiedPoint: 200,
  clarifiedPoints: 5,
} as const;

export interface ScopeEvidence {
  scope_id: string;
  scope_label: string;
}

export interface SessionScopeEvidence extends ScopeEvidence {
  entered_at: string;
}

export interface AttemptObservation {
  evidence_id: string;
  attempt_id: string;
  scope: ScopeEvidence;
  target: {
    kind: "scope" | "card" | "section";
    id: string;
    label: string;
  };
  occurred_at: string;
  difficulty: DifficultyLevel;
  type: QuestionType;
  question_excerpt: string;
  knowledge_points: string[];
  outcome: "correct" | "gave_up";
  submission_count: number;
  incorrect_submissions: number;
  discussion_occurred: boolean;
  clarified_points: string[];
}

export interface MasteryEvidence {
  evidence_id: string;
  attempt_id: string;
  scope: ScopeEvidence;
  knowledge_points: string[];
  basis: "final_answer_accepted";
  question_excerpt: string;
  revisions_before_correct: number;
}

export interface UnverifiedTopic {
  evidence_id: string;
  attempt_id: string;
  scope: ScopeEvidence;
  knowledge_points: string[];
  reason: "gave_up_without_correct_answer";
  question_excerpt: string;
}

export interface SessionEvidence {
  session: {
    session_id: string;
    subject_id: string;
    mode: ReviewMode;
    status: SessionStatus;
    started_at: string;
    ended_at?: string;
    scope_history: SessionScopeEvidence[];
  };
  totals: {
    questions: number;
    correct: number;
    gave_up: number;
    submissions: number;
    revisions: number;
    discussed_questions: number;
  };
  scopes: Array<{
    scope: ScopeEvidence;
    questions: number;
    correct: number;
    gave_up: number;
  }>;
  observed_facts: AttemptObservation[];
  mastery_evidence: MasteryEvidence[];
  unverified_topics: UnverifiedTopic[];
}

/** Normalize whitespace and truncate by Unicode code point rather than UTF-16 code unit. */
export function truncateEvidenceText(value: string, maxCharacters: number): string {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("maxCharacters must be a positive integer");
  }
  const normalized = value.trim().replace(/\s+/gu, " ");
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  return `${characters.slice(0, Math.max(0, maxCharacters - 1)).join("")}…`;
}

export function boundedUniqueStrings(
  values: readonly string[] | undefined,
  options: { maxItems: number; maxCharacters: number },
): string[] {
  if (!Number.isInteger(options.maxItems) || options.maxItems < 0) {
    throw new Error("maxItems must be a non-negative integer");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const bounded = truncateEvidenceText(value, options.maxCharacters);
    if (bounded === "" || seen.has(bounded)) continue;
    seen.add(bounded);
    result.push(bounded);
    if (result.length >= options.maxItems) break;
  }
  return result;
}

function boundedIdentifier(value: string): string {
  return truncateEvidenceText(value, SESSION_EVIDENCE_LIMITS.identifier);
}

function boundedTimestamp(value: string): string {
  return truncateEvidenceText(value, SESSION_EVIDENCE_LIMITS.timestamp);
}

function scopeEvidence(scopeId: string, scopeLabel: string): ScopeEvidence {
  return {
    scope_id: truncateEvidenceText(scopeId, SESSION_EVIDENCE_LIMITS.scope),
    scope_label: truncateEvidenceText(scopeLabel, SESSION_EVIDENCE_LIMITS.scope),
  };
}

function knowledgePointEvidence(values: readonly string[]): string[] {
  return boundedUniqueStrings(values, {
    maxItems: SESSION_EVIDENCE_LIMITS.knowledgePoints,
    maxCharacters: SESSION_EVIDENCE_LIMITS.knowledgePoint,
  });
}

function validateAttempt(session: StudySession, attempt: Attempt): void {
  if (attempt.session_id !== session.sessionId) {
    throw new Error(`Attempt ${attempt.question_id} belongs to another session`);
  }
  if (attempt.outcome === "correct" && !attempt.is_correct) {
    throw new Error(`Attempt ${attempt.question_id} has outcome=correct but is_correct=false`);
  }
  if (attempt.outcome === "gave_up" && attempt.is_correct) {
    throw new Error(`Attempt ${attempt.question_id} has outcome=gave_up but is_correct=true`);
  }
  if (attempt.outcome !== "correct" && attempt.outcome !== "gave_up") {
    throw new Error(`Attempt ${attempt.question_id} has an unsupported outcome`);
  }
}

/**
 * Projects persisted learning records into the only context the summary Agent may consume.
 * Raw answers, answer text history, self-corrections, reference answers and explanations are
 * deliberately never read into the returned object.
 */
export function buildSessionEvidence(session: StudySession, attempts: readonly Attempt[]): SessionEvidence {
  const observedFacts: AttemptObservation[] = [];
  const masteryEvidence: MasteryEvidence[] = [];
  const unverifiedTopics: UnverifiedTopic[] = [];
  const scopes = new Map<string, SessionEvidence["scopes"][number]>();

  let correct = 0;
  let gaveUp = 0;
  let submissions = 0;
  let revisions = 0;
  let discussedQuestions = 0;

  for (const attempt of attempts) {
    validateAttempt(session, attempt);

    const attemptId = boundedIdentifier(attempt.question_id);
    const scope = scopeEvidence(attempt.scope_id, attempt.scope_label);
    const target = {
      kind: attempt.target_kind,
      id: truncateEvidenceText(attempt.target_id, SESSION_EVIDENCE_LIMITS.identifier),
      label: truncateEvidenceText(attempt.target_label, SESSION_EVIDENCE_LIMITS.scope),
    };
    const questionExcerpt = truncateEvidenceText(
      attempt.question_text,
      SESSION_EVIDENCE_LIMITS.questionExcerpt,
    );
    const knowledgePoints = knowledgePointEvidence(attempt.knowledge_points);
    const answerHistory = attempt.answer_history ?? [];
    const submissionCount = answerHistory.length;
    const incorrectSubmissions = answerHistory.filter((entry) => !entry.is_correct).length;
    const discussionOccurred = attempt.discussion_summary !== undefined;
    const clarifiedPoints = boundedUniqueStrings(attempt.discussion_summary?.clarified_points, {
      maxItems: SESSION_EVIDENCE_LIMITS.clarifiedPoints,
      maxCharacters: SESSION_EVIDENCE_LIMITS.clarifiedPoint,
    });

    submissions += submissionCount;
    revisions += Math.max(0, submissionCount - 1);
    if (discussionOccurred) discussedQuestions += 1;
    if (attempt.outcome === "correct") correct += 1;
    else gaveUp += 1;

    const scopeKey = `${scope.scope_id}\u0000${scope.scope_label}`;
    let scopeTotals = scopes.get(scopeKey);
    if (!scopeTotals) {
      scopeTotals = { scope, questions: 0, correct: 0, gave_up: 0 };
      scopes.set(scopeKey, scopeTotals);
    }
    scopeTotals.questions += 1;
    if (attempt.outcome === "correct") scopeTotals.correct += 1;
    else scopeTotals.gave_up += 1;

    observedFacts.push({
      evidence_id: `${attemptId}:observed`,
      attempt_id: attemptId,
      scope,
      target,
      occurred_at: boundedTimestamp(attempt.timestamp),
      difficulty: attempt.difficulty,
      type: attempt.type,
      question_excerpt: questionExcerpt,
      knowledge_points: knowledgePoints,
      outcome: attempt.outcome,
      submission_count: submissionCount,
      incorrect_submissions: incorrectSubmissions,
      discussion_occurred: discussionOccurred,
      clarified_points: clarifiedPoints,
    });

    if (attempt.outcome === "correct") {
      masteryEvidence.push({
        evidence_id: `${attemptId}:mastery`,
        attempt_id: attemptId,
        scope,
        knowledge_points: knowledgePoints,
        basis: "final_answer_accepted",
        question_excerpt: questionExcerpt,
        revisions_before_correct: Math.max(0, submissionCount - 1),
      });
    } else {
      unverifiedTopics.push({
        evidence_id: `${attemptId}:unverified`,
        attempt_id: attemptId,
        scope,
        knowledge_points: knowledgePoints,
        reason: "gave_up_without_correct_answer",
        question_excerpt: questionExcerpt,
      });
    }
  }

  return {
    session: {
      session_id: boundedIdentifier(session.sessionId),
      subject_id: boundedIdentifier(session.subjectId),
      mode: session.mode,
      status: session.status,
      started_at: boundedTimestamp(session.createdAt),
      ...(session.endedAt === undefined ? {} : { ended_at: boundedTimestamp(session.endedAt) }),
      scope_history: session.scopeHistory.map((entry) => ({
        ...scopeEvidence(entry.scopeId, entry.scopeLabel),
        entered_at: boundedTimestamp(entry.enteredAt),
      })),
    },
    totals: {
      questions: attempts.length,
      correct,
      gave_up: gaveUp,
      submissions,
      revisions,
      discussed_questions: discussedQuestions,
    },
    scopes: Array.from(scopes.values()),
    observed_facts: observedFacts,
    mastery_evidence: masteryEvidence,
    unverified_topics: unverifiedTopics,
  };
}
