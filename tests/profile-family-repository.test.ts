import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

describe("ProfileFamilyRepository", () => {
  let dataRoot: string;
  let repository: ProfileFamilyRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-study-profile-"));
    repository = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
      now: () => new Date("2026-07-13T08:09:10.000Z"),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("初始化 canonical demo 并列出唯一 active", async () => {
    const seeded = await repository.seedDemoProfile();
    const profiles = await repository.listActiveProfiles();

    expect(seeded.subjectId).toBe("demo-review");
    expect(seeded.slot).toBe("active");
    expect(profiles.map((profile) => profile.subjectId)).toEqual(["demo-review"]);
  });

  it("复制 active 为单一修订草稿且不复制 _user", async () => {
    await repository.seedDemoProfile();
    const family = repository.familyDirectory("demo-review");
    const privateMarker = resolve(family, "_user", "private.txt");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(privateMarker, "private", "utf8"));

    const draft = await repository.createRevisionDraft("demo-review");

    expect(draft.revision).toBe(2);
    expect(draft.revisionOf).toBe("20260713-000000");
    await expect(repository.createRevisionDraft("demo-review")).rejects.toThrow("Draft already exists");
    await expect(stat(resolve(family, "draft", "_user"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(privateMarker, "utf8")).toBe("private");
  });

  it("确认修订时归档旧 active 并启用 draft", async () => {
    await repository.seedDemoProfile();
    await repository.createRevisionDraft("demo-review");
    await repository.writeDraftFile("demo-review", "subject.md", "# 已修订\n");

    const active = await repository.enableDraft("demo-review");
    const family = repository.familyDirectory("demo-review");
    const archives = await readdir(resolve(family, "archived"));

    expect(active.status).toBe("active");
    expect(active.revision).toBe(2);
    expect(await readFile(resolve(family, "active", "subject.md"), "utf8")).toBe("# 已修订\n");
    expect(archives).toEqual(["20260713-080910"]);
    expect(JSON.parse(await readFile(resolve(family, "archived", archives[0]!, "profile.json"), "utf8")).revision).toBe(1);
  });

  it("放弃草稿不改变 active", async () => {
    const original = await repository.seedDemoProfile();
    await repository.createRevisionDraft("demo-review");
    await repository.discardDraft("demo-review");

    expect((await repository.loadActiveProfile("demo-review")).version).toBe(original.version);
    await expect(repository.loadDraftProfile("demo-review")).rejects.toThrow();
  });

  it("可创建并启用没有旧 active 的新资料包", async () => {
    const draft = await repository.createDraftProfile({ subjectId: "math", name: "数学" });
    expect(draft.status).toBe("draft");

    const active = await repository.enableDraft("math");
    expect(active.status).toBe("active");
    expect(active.revision).toBe(1);
    expect(await repository.listActiveProfiles()).toHaveLength(1);
  });

  it("拒绝路径越界和破坏 draft 身份的 profile.json", async () => {
    await repository.createDraftProfile({ subjectId: "safe", name: "安全测试" });
    await expect(repository.writeDraftFile("safe", "../escape.txt", "bad")).rejects.toThrow("Unsafe relative path");
    await expect(repository.writeDraftFile("safe", "profile.json", "{}")).rejects.toThrow("Invalid canonical Profile");
    expect((await repository.loadDraftProfile("safe")).subjectId).toBe("safe");
  });
});
