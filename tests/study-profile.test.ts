import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listStudyScopes,
  loadActiveStudyTargetContext,
} from "../src/domain/study-profile.js";
import { ProfileFamilyRepository } from "../src/repositories/profile-family-repository.js";

describe("study Profile target", () => {
  let dataRoot: string;
  let profiles: ProfileFamilyRepository;

  beforeEach(async () => {
    dataRoot = await mkdtemp(resolve(tmpdir(), "pi-study-profile-target-"));
    profiles = new ProfileFamilyRepository({
      dataRoot,
      fixturesRoot: resolve(process.cwd(), "fixtures", "profiles"),
    });
    await profiles.seedDemoProfile();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("从 canonical index 列出章节、卡片和小节", async () => {
    const scopes = await listStudyScopes(profiles, "demo-review");
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toMatchObject({
      id: "chapter:1",
      cards: [
        { id: "active_recall", path: "cards/active_recall.md" },
        { id: "spaced_review", path: "cards/spaced_review.md" },
        { id: "interleaving", path: "cards/interleaving.md" },
      ],
      sections: [{ id: "ch01-sec01", path: "chapters/01/01.01.md" }],
    });
  });

  it("卡片 target 只暴露单卡片和单知识点", async () => {
    const context = await loadActiveStudyTargetContext(
      profiles,
      "demo-review",
      "chapter:1",
      "card",
      "active_recall",
    );
    expect(context.target).toEqual({
      kind: "card",
      id: "active_recall",
      label: "主动回忆",
      knowledgePointIds: ["active_recall"],
    });
    expect(context.material).toContain("# 主动回忆");
    expect(context.material).not.toContain("# 间隔复习");
  });

  it("小节 target 只暴露该小节和所属知识点", async () => {
    const context = await loadActiveStudyTargetContext(
      profiles,
      "demo-review",
      "chapter:1",
      "section",
      "ch01-sec01",
    );
    expect(context.target.knowledgePointIds).toEqual(["active_recall", "spaced_review", "interleaving"]);
    expect(context.material).toContain("# 记忆与练习");
    expect(context.material).not.toContain("# 主动回忆");
  });
});
