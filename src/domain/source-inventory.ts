import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { assertSafeRelativePath } from "../infrastructure/safe-files.js";

export interface SourceInventoryLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  batchCharacters: number;
}

export const DEFAULT_SOURCE_INVENTORY_LIMITS: SourceInventoryLimits = {
  maxFiles: 100,
  maxFileBytes: 1_000_000,
  maxTotalBytes: 5_000_000,
  batchCharacters: 24_000,
};

export interface SourceFileInventory {
  sourceId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  characters: number;
}

export interface SourceInventory {
  root: string;
  files: SourceFileInventory[];
  totalBytes: number;
  totalCharacters: number;
}

export interface SourceBatch {
  index: number;
  files: Array<SourceFileInventory & {
    startCharacter?: number;
    endCharacter?: number;
  }>;
  characters: number;
}

export interface LoadedSourceBatch {
  index: number;
  sources: Array<SourceFileInventory & { content: string }>;
}

function normalizeText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n?/g, "\n");
}

function sourceHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function inventorySourceDirectory(
  sourceRoot: string,
  limits: SourceInventoryLimits = DEFAULT_SOURCE_INVENTORY_LIMITS,
): Promise<SourceInventory> {
  const root = resolve(sourceRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("Source path must be a directory");

  const candidates: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !/\.(md|txt)$/iu.test(entry.name)) continue;
      candidates.push(absolutePath);
      if (candidates.length > limits.maxFiles) throw new Error(`Source file count exceeds ${limits.maxFiles}`);
    }
  };
  await visit(root);
  if (candidates.length === 0) throw new Error("Source directory contains no Markdown or txt files");

  const files: SourceFileInventory[] = [];
  let totalBytes = 0;
  let totalCharacters = 0;
  for (const [index, absolutePath] of candidates.entries()) {
    const buffer = await readFile(absolutePath);
    if (buffer.byteLength > limits.maxFileBytes) {
      throw new Error(`Source file exceeds ${limits.maxFileBytes} bytes: ${relative(root, absolutePath)}`);
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > limits.maxTotalBytes) throw new Error(`Source total exceeds ${limits.maxTotalBytes} bytes`);
    const text = normalizeText(buffer);
    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");
    assertSafeRelativePath(relativePath);
    const sha256 = sourceHash(buffer);
    files.push({
      sourceId: `src-${String(index + 1).padStart(3, "0")}-${sha256.slice(0, 12)}`,
      relativePath,
      sha256,
      bytes: buffer.byteLength,
      characters: Array.from(text).length,
    });
    totalCharacters += Array.from(text).length;
  }

  return { root, files, totalBytes, totalCharacters };
}

export function createSourceBatches(
  inventory: SourceInventory,
  batchCharacters = DEFAULT_SOURCE_INVENTORY_LIMITS.batchCharacters,
): SourceBatch[] {
  if (!Number.isInteger(batchCharacters) || batchCharacters < 1) throw new Error("batchCharacters must be positive");
  const batches: SourceBatch[] = [];
  let files: SourceFileInventory[] = [];
  let characters = 0;
  const flush = (): void => {
    if (files.length === 0) return;
    batches.push({ index: batches.length, files, characters });
    files = [];
    characters = 0;
  };
  for (const file of inventory.files) {
    if (file.characters > batchCharacters) {
      flush();
      for (let startCharacter = 0; startCharacter < file.characters; startCharacter += batchCharacters) {
        const endCharacter = Math.min(file.characters, startCharacter + batchCharacters);
        batches.push({
          index: batches.length,
          files: [{ ...file, startCharacter, endCharacter }],
          characters: endCharacter - startCharacter,
        });
      }
      continue;
    }
    if (files.length > 0 && characters + file.characters > batchCharacters) {
      flush();
    }
    files.push(file);
    characters += file.characters;
  }
  flush();
  return batches;
}

export async function loadSourceBatch(inventory: SourceInventory, batch: SourceBatch): Promise<LoadedSourceBatch> {
  const sources: LoadedSourceBatch["sources"] = [];
  for (const file of batch.files) {
    assertSafeRelativePath(file.relativePath);
    const absolutePath = resolve(inventory.root, file.relativePath);
    const buffer = await readFile(absolutePath);
    if (sourceHash(buffer) !== file.sha256) {
      throw new Error(`Source file changed after inventory: ${file.relativePath}`);
    }
    const characters = Array.from(normalizeText(buffer));
    const startCharacter = file.startCharacter ?? 0;
    const endCharacter = file.endCharacter ?? characters.length;
    if (startCharacter < 0 || endCharacter <= startCharacter || endCharacter > characters.length) {
      throw new Error(`Source batch range is invalid: ${file.relativePath}`);
    }
    sources.push({ ...file, content: characters.slice(startCharacter, endCharacter).join("") });
  }
  return { index: batch.index, sources };
}
