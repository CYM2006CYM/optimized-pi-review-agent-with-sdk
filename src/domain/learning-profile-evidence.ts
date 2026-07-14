import type { PendingLearningRecordBatch } from "../repositories/private-memory-repository.js";
import type { LearningProfile } from "./types.js";
import { buildSessionEvidence, boundedUniqueStrings, truncateEvidenceText } from "./session-evidence.js";

const PROFILE_TEXT_LIMIT = 2_000;
const PROFILE_ITEM_LIMIT = 20;
const PROFILE_ITEM_TEXT_LIMIT = 200;
const RECENT_SESSION_LIMIT = 20;

export interface LearningProfileBatchEvidence {
  batch_id: string;
  session_id: string;
  status: "completed" | "interrupted";
  summary_excerpt: string;
  session_evidence: ReturnType<typeof buildSessionEvidence>;
}

export interface LearningProfileEvidence {
  subject_id: string;
  existing_profile: LearningProfile | null;
  selected_batches: LearningProfileBatchEvidence[];
  deterministic_totals: {
    previous_questions: number;
    previous_correct: number;
    selected_questions: number;
    selected_correct: number;
    total_questions: number;
    total_correct: number;
    accuracy: number;
  };
}

export interface LearningProfileCandidate {
  profile_summary: string;
  weak_points: string[];
  strengths: string[];
  unverified_topics: string[];
  recommendations: string[];
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? value ?? 0 : 0;
}

export function buildLearningProfileEvidence(
  subjectId: string,
  existingProfile: LearningProfile | null,
  batches: readonly PendingLearningRecordBatch[],
): LearningProfileEvidence {
  if (batches.length === 0) throw new Error("At least one learning record batch is required");
  const selectedBatches = batches.map((batch): LearningProfileBatchEvidence => {
    if (batch.subjectId !== subjectId || batch.session.subjectId !== subjectId) {
      throw new Error(`Learning record batch ${batch.batchId} belongs to another subject`);
    }
    if (batch.session.status === "running") {
      throw new Error(`Cannot build a learning profile from running batch: ${batch.batchId}`);
    }
    return {
      batch_id: truncateEvidenceText(batch.batchId, 160),
      session_id: truncateEvidenceText(batch.session.sessionId, 160),
      status: batch.session.status,
      summary_excerpt: truncateEvidenceText(batch.summaryMarkdown ?? "", PROFILE_TEXT_LIMIT),
      session_evidence: buildSessionEvidence(batch.session, batch.attempts),
    };
  });

  const previousQuestions = finiteNonNegative(existingProfile?.total_questions);
  const previousCorrect = finiteNonNegative(existingProfile?.total_correct);
  const selectedQuestions = selectedBatches.reduce((total, batch) => total + batch.session_evidence.totals.questions, 0);
  const selectedCorrect = selectedBatches.reduce((total, batch) => total + batch.session_evidence.totals.correct, 0);
  const totalQuestions = previousQuestions + selectedQuestions;
  const totalCorrect = previousCorrect + selectedCorrect;

  return {
    subject_id: subjectId,
    existing_profile: existingProfile,
    selected_batches: selectedBatches,
    deterministic_totals: {
      previous_questions: previousQuestions,
      previous_correct: previousCorrect,
      selected_questions: selectedQuestions,
      selected_correct: selectedCorrect,
      total_questions: totalQuestions,
      total_correct: totalCorrect,
      accuracy: totalQuestions === 0 ? 0 : totalCorrect / totalQuestions,
    },
  };
}

function boundedProfileItems(values: readonly string[]): string[] {
  return boundedUniqueStrings(values, {
    maxItems: PROFILE_ITEM_LIMIT,
    maxCharacters: PROFILE_ITEM_TEXT_LIMIT,
  });
}

export function assembleLearningProfile(
  evidence: LearningProfileEvidence,
  candidate: LearningProfileCandidate,
  updatedAt: string,
): LearningProfile {
  const previousSessions = evidence.existing_profile?.recent_sessions ?? [];
  const selectedSessions = evidence.selected_batches.map((batch) => batch.session_id);
  const allSessions = boundedUniqueStrings([...previousSessions, ...selectedSessions], {
    maxItems: previousSessions.length + selectedSessions.length,
    maxCharacters: 160,
  });
  const recentSessions = allSessions.slice(-RECENT_SESSION_LIMIT);

  return {
    subject_id: evidence.subject_id,
    updated_at: updatedAt,
    total_questions: evidence.deterministic_totals.total_questions,
    total_correct: evidence.deterministic_totals.total_correct,
    accuracy: evidence.deterministic_totals.accuracy,
    profile_summary: truncateEvidenceText(candidate.profile_summary, PROFILE_TEXT_LIMIT),
    weak_points: boundedProfileItems(candidate.weak_points),
    strengths: boundedProfileItems(candidate.strengths),
    unverified_topics: boundedProfileItems(candidate.unverified_topics),
    recommendations: boundedProfileItems(candidate.recommendations),
    recent_sessions: recentSessions,
  };
}
