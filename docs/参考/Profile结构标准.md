# Profile 结构标准

> 状态：draft
> 更新日期：2026-07-05

本文定义 review profile 的目标结构。它不是对历史资料包的描述，而是后续 `/review-init`、`/review-fix`、doctor、profile 分享和资料包维护应收敛到的标准。

## 背景

当前 profile 曾经历多轮演进，实际数据里同时存在几类结构：

- 旧版平铺 profile：`review_profiles/{subjectId}/profile.json`。
- 当前 family layout：`review_profiles/{subjectId}/active|draft|archived|_user`。
- 平铺章节文件：`chapters/1.1 xxx.md`。
- 嵌套章节文件：`chapters/1/1.1 xxx.md` 或类似目录。
- 增量资料残留目录：如 `chapters_nt`、`cards_nt`、`exam_points_nt`。

这些形态都能被兼容层读取，但它们不应继续作为新 profile 的生成标准。否则章节匹配、卡片匹配、source_map、quality_report、doctor 和后续分享机制都会继续依赖猜测。

## 标准目录结构

运行态 profile family 必须使用以下结构：

```text
review_profiles/{subjectId}/
├── active/
│   ├── profile.json
│   ├── subject.md
│   ├── knowledge_index.json
│   ├── cards/
│   ├── chapters/
│   │   ├── 01/
│   │   │   ├── 01.01.md
│   │   │   └── 01.02.md
│   │   └── 02/
│   │       └── 02.01.md
│   ├── exam_points/
│   │   ├── 01.md
│   │   └── 02.md
│   ├── source_map.json
│   └── quality_report.md
├── draft/
├── archived/
└── _user/
    ├── learning_profile.json
    └── summaries/
```

约定：

- `active/` 是唯一可复习版本，运行时只读。
- `draft/` 是唯一可写版本，`review_profile_write` 只能写入这里。
- `archived/` 保存被替换的历史 active，不参与默认选择。
- `_user/` 保存用户私有学习数据，不随 profile 分享发布。
- 新 profile 不再生成 `chapters_nt`、`cards_nt`、`exam_points_nt` 这类增量目录。

## 必需元数据

### profile.json

`profile.json` 必须说明 profile 身份、状态、路径和 revision 信息。

```json
{
  "subjectId": "lisan",
  "name": "离散数学",
  "status": "active",
  "slot": "active",
  "version": "20260705-120000",
  "revision": 1,
  "paths": {
    "subject": "subject.md",
    "knowledgeIndex": "knowledge_index.json",
    "cards": "cards",
    "chapters": "chapters",
    "examPoints": "exam_points",
    "sourceMap": "source_map.json",
    "qualityReport": "quality_report.md"
  }
}
```

约定：

- `subjectId` 必须稳定，revision draft 不得把 `__draft_YYYYMMDD` 写入最终 active id。
- 使用 `revision`，不再新增 `revisionNumber`。
- `paths.*` 不得包含 `..`。

### knowledge_index.json

`knowledge_index.json` 是章节、知识点、卡片和章节材料的主索引。

```json
{
  "subject": "离散数学",
  "chapters": {
    "1": {
      "id": "1",
      "title": "整除性与互质",
      "sections": [
        {
          "id": "ch01-sec01",
          "section": "1.1",
          "title": "整除基本概念",
          "path": "chapters/01/01.01.md"
        }
      ],
      "knowledge_points": [
        {
          "id": "divisibility-basics",
          "name": "整除基本概念",
          "chapter": "1",
          "section": "1.1",
          "card_id": "divisibility-basics",
          "question_types": ["judgment", "choice", "short_answer"],
          "difficulty_baseline": "S-R",
          "related": [],
          "common_misconceptions": []
        }
      ]
    }
  }
}
```

约定：

- `chapters.{id}.knowledge_points[]` 是必需结构。
- 每个知识点必须有稳定 `id`，不得只依赖中文 `name`。
- 每个知识点应明确 `chapter`、`section`、`card_id`。
- `sections[]` 是章节材料的标准入口；文件名只是存储细节。

### chapters/*.md

章节材料必须带 frontmatter。

```markdown
---
id: ch01-sec01
chapter: "1"
section: "1.1"
title: 整除基本概念
status: active
source_ids: ["src-lisan-nt-001"]
---

# 整除基本概念
```

约定：

- `chapter` 和 `section` 是匹配依据。
- 文件名不参与语义判断，只用于人工可读和排序。
- 无 frontmatter 的旧章节文件只进入 legacy fallback。

### cards/*.md

概念卡片必须带 frontmatter。

```markdown
---
id: divisibility-basics
name: 整除基本概念
aliases: [整除, divisibility]
chapter: "1"
section: "1.1"
status: active
source_ids: ["src-lisan-nt-001"]
---

# 整除基本概念
```

约定：

- `id` 必须能被 `knowledge_points[].card_id` 引用。
- `aliases` 用于用户输入和旧名称兼容，不替代 `id`。
- 文件名只作为 fallback，不作为主匹配规则。

### exam_points/*.md

每章至少一份考点总结。

```markdown
---
id: exam-ch01
chapter: "1"
title: 整除性与互质考点总结
status: active
source_ids: ["src-lisan-nt-001"]
---

# 第 1 章考点总结
```

约定：

- 文件路径建议为 `exam_points/01.md`。
- doctor 应检查每个 chapter 是否存在对应 exam point。

### source_map.json

`source_map.json` 记录 profile 文件与来源材料的关系。

```json
{
  "sources": [
    {
      "id": "src-lisan-nt-001",
      "path": "reference/离散/离散数学复习.md",
      "type": "markdown",
      "status": "available"
    }
  ],
  "mappings": {
    "chapters/01/01.01.md": ["src-lisan-nt-001"],
    "cards/divisibility-basics.md": ["src-lisan-nt-001"],
    "exam_points/01.md": ["src-lisan-nt-001"]
  },
  "unmapped_sources": [],
  "uncertain_mappings": {}
}
```

约定：

- `source_ids` 必须能在 `sources[]` 中找到。
- `uncertain_mappings` 允许存在，但 quality_report 必须说明风险。

### quality_report.md

质量报告必须说明生成时间、覆盖情况和缺口。

最低内容：

- profile 基本信息。
- 章节数、知识点数、卡片数、考点总结数。
- 缺失卡片列表。
- 缺失 exam_points 列表。
- source_map 覆盖情况。
- legacy fallback 使用情况。

## Init 标准

`/review-init` 生成新 profile 时必须：

- 只生成 canonical layout。
- 所有章节材料、卡片、考点总结都写 frontmatter。
- `knowledge_index.json` 先写结构，再生成文件，避免文件和索引互相猜。
- `card_id` 必须对应实际卡片 `id`。
- `source_map.json` 和 `quality_report.md` 必须同步生成。
- 不生成 `_nt` 这类增量目录；增量内容应合并到标准目录。

## Doctor 标准

doctor 应区分三类结果：

- **error**：会影响 `/review` 正常使用。
- **warning**：可兼容读取，但不符合 canonical layout。
- **info**：状态说明。

建议检查项：

| 检查项 | 不通过级别 |
| --- | --- |
| active/draft/archived/_user family layout | error |
| active profile 必需文件缺失 | error |
| `_user` 不可写 | error |
| `knowledge_index.json` 没有 `chapters` object | error |
| 章节材料无 frontmatter 但可从文件名 fallback | warning |
| 知识点缺少 `card_id` 或找不到卡片 | warning |
| 章节缺少 exam_points | warning |
| 存在 `_nt`、多层 `__draft_`、`revisionNumber` | warning |
| source_map 有 unmapped 或 uncertain | warning |

## Legacy Fallback 边界

运行时代码可以继续兼容旧结构，但 fallback 必须是显式降级：

1. 优先使用 `knowledge_index.chapters[].sections[].path`。
2. 其次读取 chapter/card/exam frontmatter。
3. 再退回到 `1.1 xxx.md`、中文文件名、模糊匹配。
4. 每次 fallback 都应能被 doctor 报告。

兼容层的目标是避免用户资料突然不可用，不是鼓励继续生成旧结构。

## 迁移方向

对现有 `lisan`、`cpp-oop` 等资料包，建议按以下顺序迁移：

1. doctor 报告 canonical 差异，不修改文件。
2. 生成 migration draft，不覆盖 active。
3. 补齐 frontmatter、`card_id`、source_map 和 quality_report。
4. 用户确认后启用 draft。
5. archived 只保留必要历史，其余交给 prune dry-run 处理。

## 决策

- 新 profile 以 canonical layout 为唯一生成标准。
- legacy fallback 只用于读取旧资料包。
- doctor 是结构收敛的入口，不只是故障排查工具。
- profile 分享包不包含 `_user/`。
