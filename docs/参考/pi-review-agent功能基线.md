# Pi Review Agent 功能基线

> 来源：`C:\Users\25173\Desktop\pi-review-agent`  
> 核对日期：2026-07-13  
> 用途：提取产品场景和验收样例，不复制兼容契约。

## 当前产品入口

- `/review`：选择 Profile、模式、范围、难度和题型后开始复习。
- `/review-init`：从 Markdown/text 创建 draft Profile。
- `/review-fix`：修订 draft，或从 active 创建安全 revision draft。

## 当前核心场景

| 场景 | 前置材料 | 共同后续流程 |
| --- | --- | --- |
| `card_practice` | 概念卡片 | 出题 → 答题 → 判题 → 归档 → 题后动作 |
| `practice` | 有章节时展示考点 | 出题 → 答题 → 判题 → 归档 → 题后动作 |
| `chapter_study` | 章节/小节材料 | 出题 → 答题 → 判题 → 归档 → 题后动作 |

当前注册九个业务工具：材料类 `review_card`、`review_exam_points`、`review_chapter`；交互与状态类 `review_answer`、`review_archive`、`review_turn_action`、`review_summary`；Profile 类 `review_profile_write`、`review_profile_enable`。

## 可保留的产品行为

- 材料在相关模式出题前展示。
- 结构化题目支持判断、单选、多选和简答。
- 题后归档更新进度、错题与知识状态。
- 用户可继续、查看材料、讨论、总结或退出。
- 总结更新科目学习画像。
- Profile 构建与修订只能写入 draft，启用前需要检查。

这些行为需要在新项目重新建模和验收，工具名及文件结构不保留。

## 当前试验图的启示

`workspace/lib/review_loop_graph.mjs` 已定义七节点单题图：准备、展示材料、生成、答题、判题、归档、题后动作。它证明业务可映射到图，但四个确定性阶段仍通过 Agent 调工具，因此单题通常约六次 Agent Run。

新项目应保留显式阶段，改为由代码节点执行材料、答题、归档和菜单，只保留生成与判题两个必要 Agent Run。

## 不继承的内容

- wrapper + `workspace/` 双层 package 布局。
- Profile family 的旧 active/draft/archived 文件布局及 revision fallback。
- 旧命令名和工具名。
- 旧离散难度体系作为不可更改契约。
- 由 prompt 要求 Agent “必须调用下一个工具”的控制方式。
- 旧路径兼容、legacy CLI 和历史数据迁移。

## 测试基线

`npm test` 在核对日通过 35/35，覆盖 Profile 安全、资料加载、题目规范化、学习画像、试验图结构等。新项目可将这些测试名称转写成产品场景，但不复制对旧目录结构的断言。
