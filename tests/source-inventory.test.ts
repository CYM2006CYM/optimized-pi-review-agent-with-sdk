import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSourceBatches,
  inventorySourceDirectory,
  loadSourceBatch,
} from "../src/domain/source-inventory.js";

describe("source inventory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "pi-profile-source-"));
    await mkdir(resolve(root, "nested"));
    await writeFile(resolve(root, "01.md"), "# 第一章\n\n主动回忆。\n", "utf8");
    await writeFile(resolve(root, "nested", "02.txt"), "反馈闭环。\n", "utf8");
    await writeFile(resolve(root, "ignored.json"), "{}", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("递归盘点 md/txt、计算 hash 并按字符预算分批", async () => {
    const inventory = await inventorySourceDirectory(root);
    expect(inventory.files.map((file) => file.relativePath)).toEqual(["01.md", "nested/02.txt"]);
    expect(inventory.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
    expect(inventory.files.every((file) => file.sourceId.startsWith("src-"))).toBe(true);

    const batches = createSourceBatches(inventory, 10);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.every((batch) => batch.characters <= 10)).toBe(true);
    const loaded = await loadSourceBatch(inventory, batches[0]!);
    expect(loaded.sources[0]?.content).toContain("第一章");
  });

  it("盘点后文件变化时拒绝继续构建", async () => {
    const inventory = await inventorySourceDirectory(root);
    const [batch] = createSourceBatches(inventory);
    await writeFile(resolve(root, "01.md"), "changed", "utf8");

    await expect(loadSourceBatch(inventory, batch!)).rejects.toThrow("changed after inventory");
  });

  it("单个大文件也会被切分到字符预算内且不丢内容", async () => {
    const content = "主动回忆与间隔复习。".repeat(20);
    await writeFile(resolve(root, "large.md"), content, "utf8");
    const inventory = await inventorySourceDirectory(root);
    const large = inventory.files.find((file) => file.relativePath === "large.md")!;
    const batches = createSourceBatches({ ...inventory, files: [large] }, 25);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.characters <= 25)).toBe(true);
    const loaded = await Promise.all(batches.map((batch) => loadSourceBatch(inventory, batch)));
    expect(loaded.flatMap((batch) => batch.sources).map((source) => source.content).join(""))
      .toBe(content);
  });

  it("拒绝超过文件数量和单文件大小限制的输入", async () => {
    await expect(inventorySourceDirectory(root, {
      maxFiles: 1,
      maxFileBytes: 1_000,
      maxTotalBytes: 2_000,
      batchCharacters: 100,
    })).rejects.toThrow("file count");
    await expect(inventorySourceDirectory(root, {
      maxFiles: 10,
      maxFileBytes: 2,
      maxTotalBytes: 2_000,
      batchCharacters: 100,
    })).rejects.toThrow("Source file exceeds");
  });
});
