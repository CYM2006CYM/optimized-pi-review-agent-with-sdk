import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function assertSafeSubjectId(subjectId: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(subjectId)) {
    throw new Error(`Invalid subjectId: ${subjectId}`);
  }
}

export function assertSafeFileComponent(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function assertPathInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return resolvedCandidate;
  }
  throw new Error(`Path escapes data root: ${candidate}`);
}

export function resolveInside(root: string, ...segments: string[]): string {
  return assertPathInside(root, resolve(root, ...segments));
}

export function assertSafeRelativePath(path: string): void {
  if (path.length === 0 || path.includes("\0")) {
    throw new Error("Relative path must not be empty");
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Absolute path is not allowed: ${path}`);
  }
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
