import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Profile, ProfilePaths, ProfileSlot } from "./types.js";
import { assertSafeRelativePath } from "../infrastructure/safe-files.js";

export const CANONICAL_PROFILE_PATHS: ProfilePaths = {
  subject: "subject.md",
  knowledgeIndex: "knowledge_index.json",
  cards: "cards",
  chapters: "chapters",
  examPoints: "exam_points",
  sourceMap: "source_map.json",
  qualityReport: "quality_report.md",
};

const REQUIRED_FILE_KEYS = [
  "subject",
  "knowledgeIndex",
  "sourceMap",
  "qualityReport",
] as const;

const REQUIRED_DIRECTORY_KEYS = ["cards", "chapters", "examPoints"] as const;

export class ProfileValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid canonical Profile:\n- ${issues.join("\n- ")}`);
    this.name = "ProfileValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateManifestValue(value: unknown, expectedSubjectId?: string, expectedSlot?: ProfileSlot): Profile {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new ProfileValidationError(["profile.json must contain an object"]);
  }

  const requiredStrings = ["subjectId", "name", "status", "slot", "version", "createdAt", "updatedAt"];
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key] === "") issues.push(`${key} must be a non-empty string`);
  }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) {
    issues.push("revision must be a positive integer");
  }
  if (value.status !== "active" && value.status !== "draft") issues.push("status must be active or draft");
  if (value.slot !== "active" && value.slot !== "draft") issues.push("slot must be active or draft");
  if (value.status !== value.slot) issues.push("status and slot must match");
  if (expectedSubjectId !== undefined && value.subjectId !== expectedSubjectId) {
    issues.push(`subjectId must be ${expectedSubjectId}`);
  }
  if (expectedSlot !== undefined && value.slot !== expectedSlot) issues.push(`slot must be ${expectedSlot}`);
  if (!isRecord(value.paths)) {
    issues.push("paths must be an object");
  } else {
    for (const [key, canonicalPath] of Object.entries(CANONICAL_PROFILE_PATHS)) {
      if (value.paths[key] !== canonicalPath) issues.push(`paths.${key} must be ${canonicalPath}`);
      if (typeof value.paths[key] === "string") {
        try {
          assertSafeRelativePath(value.paths[key]);
        } catch {
          issues.push(`paths.${key} must stay inside the Profile directory`);
        }
      }
    }
  }
  if (value.revisionOf !== undefined && typeof value.revisionOf !== "string") {
    issues.push("revisionOf must be a string when present");
  }

  if (issues.length > 0) throw new ProfileValidationError(issues);
  return value as unknown as Profile;
}

export function parseProfileManifest(raw: string, expectedSubjectId?: string, expectedSlot?: ProfileSlot): Profile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProfileValidationError(["profile.json is not valid JSON"]);
  }
  return validateManifestValue(value, expectedSubjectId, expectedSlot);
}

export async function validateCanonicalProfileDirectory(
  directory: string,
  expectedSubjectId?: string,
  expectedSlot?: ProfileSlot,
): Promise<Profile> {
  const issues: string[] = [];
  let profile: Profile | undefined;
  try {
    profile = parseProfileManifest(await readFile(resolve(directory, "profile.json"), "utf8"), expectedSubjectId, expectedSlot);
  } catch (error) {
    if (error instanceof ProfileValidationError) issues.push(...error.issues);
    else issues.push("profile.json is missing or unreadable");
  }

  const paths = profile?.paths ?? CANONICAL_PROFILE_PATHS;
  for (const key of REQUIRED_FILE_KEYS) {
    try {
      if (!(await stat(resolve(directory, paths[key]))).isFile()) issues.push(`${paths[key]} must be a file`);
    } catch {
      issues.push(`${paths[key]} is missing`);
    }
  }
  for (const key of REQUIRED_DIRECTORY_KEYS) {
    try {
      if (!(await stat(resolve(directory, paths[key]))).isDirectory()) issues.push(`${paths[key]} must be a directory`);
    } catch {
      issues.push(`${paths[key]} is missing`);
    }
  }

  if (profile !== undefined) {
    try {
      const index = JSON.parse(await readFile(resolve(directory, profile.paths.knowledgeIndex), "utf8")) as unknown;
      if (!isRecord(index) || !isRecord(index.chapters)) issues.push("knowledge_index.json must contain a chapters object");
    } catch {
      issues.push("knowledge_index.json is not valid JSON");
    }
    try {
      const sourceMap = JSON.parse(await readFile(resolve(directory, profile.paths.sourceMap), "utf8")) as unknown;
      if (!isRecord(sourceMap) || !Array.isArray(sourceMap.sources) || !isRecord(sourceMap.mappings)) {
        issues.push("source_map.json must contain sources[] and mappings{}");
      }
    } catch {
      issues.push("source_map.json is not valid JSON");
    }
  }

  if (issues.length > 0 || profile === undefined) throw new ProfileValidationError(issues);
  return profile;
}
