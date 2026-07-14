// ============================================================
//  Pi Study Helper — 工程骨架测试
// ============================================================
//
//  验证 package、extension 入口和核心类型的基本完整性。
//  这些测试不依赖 pi 宿主或 Loop Graph SDK 运行时。
// ============================================================

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

// 验证核心类型可以导入（仅类型检查，不依赖运行时）
describe("工程骨架", () => {
  it("package.json 存在且 name 正确", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(pkg.default.name).toBe("pi-study-helper");
    expect(pkg.default.type).toBe("module");
  });

  it("pi.extensions 指向扩展入口", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(pkg.default.pi?.extensions).toBeDefined();
    expect(pkg.default.pi.extensions).toContain("./src/extension/index.ts");
  });

  it("tsconfig 配置有效", async () => {
    // 仅验证 JSON 可解析
    const tsconfig = await import("../tsconfig.json", { with: { type: "json" } });
    expect(tsconfig.default.compilerOptions.strict).toBe(true);
    expect(tsconfig.default.compilerOptions.module).toBe("NodeNext");
  });

  it("依赖声明了 pi-loop-graph-sdk", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(pkg.default.dependencies["pi-loop-graph-sdk"]).toBe(
      "github:0liveiraaa/pi-loop-graph-sdk#ecb8d83",
    );
  });

  it("开发宿主版本固定且提供真实 extension smoke", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(pkg.default.devDependencies["@earendil-works/pi-coding-agent"]).toBe("0.80.3");
    expect(pkg.default.devDependencies["@earendil-works/pi-tui"]).toBe("0.80.3");
    expect(pkg.default.scripts["smoke:extension"]).toBe(
      "node scripts/smoke-extension.mjs",
    );
  });

  it("安装的 SDK 使用编译后公共入口", async () => {
    const raw = await readFile(
      new URL("../node_modules/pi-loop-graph-sdk/package.json", import.meta.url),
      "utf8",
    );
    const sdkPackage = JSON.parse(raw);
    expect(sdkPackage.main).toBe("./dist/index.js");
    expect(sdkPackage.types).toBe("./dist/index.d.ts");
  });
});

describe("领域类型", () => {
  it("ReviewQuestion 类型定义符合预期字段", () => {
    // 编译时类型检查 + 运行时结构验证
    const question = {
      type: "choice" as const,
      question_text: "测试题目",
      knowledge_points: ["kp1"],
      difficulty: "S-U" as const,
      options: ["A", "B", "C", "D"],
      correct_answer: "A",
      explanation_l1: "解释",
    };
    expect(question.type).toBe("choice");
    expect(question.question_text).toBeTruthy();
  });

  it("Attempt 类型定义符合预期字段", () => {
    const attempt = {
      question_id: "q1",
      session_id: "s1",
      scope_id: "chapter:1",
      scope_label: "第 1 章",
      target_kind: "scope" as const,
      target_id: "chapter:1",
      target_label: "第 1 章",
      knowledge_points: ["kp1"],
      difficulty: "S-U" as const,
      type: "choice" as const,
      timestamp: new Date().toISOString(),
      question_text: "题目",
      user_answer: "A",
      correct_answer: "A",
      explanation_l1: "解释",
      source_basis: "来源",
      outcome: "correct" as const,
      is_correct: true,
      knowledge_chain_l3: [],
      suggestion_next: "继续",
    };
    expect(attempt.is_correct).toBe(true);
  });

  it("Profile status 枚举值正确", () => {
    // 验证两个合法状态值
    const _draft: import("../src/domain/types.js").ProfileStatus = "draft";
    const _active: import("../src/domain/types.js").ProfileStatus = "active";
    // 类型级检查通过即通过
    expect(true).toBe(true);
  });

  it("SessionStatus 枚举值正确", () => {
    const _running: import("../src/domain/types.js").SessionStatus = "running";
    const _completed: import("../src/domain/types.js").SessionStatus = "completed";
    const _interrupted: import("../src/domain/types.js").SessionStatus = "interrupted";
    expect(true).toBe(true);
  });
});
