import { describe, expect, it } from "vitest";
import { prepareMaterialForDisplay } from "../src/domain/material-display.js";

describe("prepareMaterialForDisplay", () => {
  it("移除资料路径、frontmatter、出题提示和来源章节", () => {
    const material = `--- 资料：cards/demo.md ---
---
id: demo
source_ids: [secret]
---

# 主动回忆

## 定义

先尝试提取。

## 出题提示

SECRET-GENERATION-HINT

## 关联

间隔复习。

## 来源

SECRET-SOURCE`;

    const displayed = prepareMaterialForDisplay(material);
    expect(displayed).toContain("# 主动回忆");
    expect(displayed).toContain("先尝试提取");
    expect(displayed).toContain("间隔复习");
    expect(displayed).not.toContain("id: demo");
    expect(displayed).not.toContain("SECRET");
    expect(displayed).not.toContain("资料：");
  });

  it("移除拼接材料中每个文件各自的 frontmatter", () => {
    const material = `--- 资料：cards/one.md ---
---
id: one
---
# 第一份

正文一

--- 资料：cards/two.md ---
---
id: two
source_ids: [secret]
---
# 第二份

正文二`;

    const displayed = prepareMaterialForDisplay(material);
    expect(displayed).toContain("# 第一份");
    expect(displayed).toContain("# 第二份");
    expect(displayed).toContain("正文一");
    expect(displayed).toContain("正文二");
    expect(displayed).not.toContain("id: one");
    expect(displayed).not.toContain("id: two");
    expect(displayed).not.toContain("source_ids");
  });
});
