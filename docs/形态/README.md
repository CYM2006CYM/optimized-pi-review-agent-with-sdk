# 当前形态

> 状态日期：2026-07-13
> 本文只记录已经由代码、自动测试或真实 pi probe 证明的事实。

## 当前可运行链路

Pi Study Helper 已经不再是工程骨架。当前主链路为：

```text
/study
→ 选择 active Profile、范围、学习方式、难度和题型
→ 代码读取 canonical Profile
→ Agent 生成题目
→ 用户答题
→ Agent 语义判题
→ 错误时重答、讨论或放弃
→ 解析与题目消化
→ 代码立即保存题目记录
→ 题后功能菜单
→ 结束时 Agent 生成总结
→ 代码保存总结并把会话标记为 completed
```

交互式 `/study` 全分支尚待人工 E2E，因此当前只能称为“功能已经实现并通过核心 probe”，不能称为里程碑一验收完成。

## 已实现

### 工程与 SDK 接入

- TypeScript 严格模式、Vitest、文档链接检查和真实 pi/RPC smoke 已建立。
- `pi-loop-graph-sdk` 固定到 Git commit `0a80dd08f163df9ecc2089a3ab7d426b1bb883b3`。
- SDK 从编译后的 `dist` 公共入口加载，不再使用本地 tarball 或 SDK 工作区源码。
- extension 使用自定义 `/study` 命令持有 TUI gateway，并程序化调用 `executeGraph()`。
- 代码节点直接调用 repository，不依赖当前不可用的 `NodeContext.callTool()`。
- 生命周期事件写入私有数据根下的 JSONL trace，不参与业务判断。

### Profile family

默认数据根为：

```text
%USERPROFILE%/.pi/agent/study-helper-data
```

可通过 `PI_STUDY_DATA` 覆盖。每个科目使用：

```text
profile_families/{subjectId}/
├── active/
├── draft/
├── archived/
└── _user/
```

已经实现：

- canonical `profile.json` 和目录结构校验。
- `demo-review` fixture 初始化为 active Profile。
- 列出和读取 active Profile。
- 创建全新 draft。
- 从 active 复制 revision draft，不复制 `_user`。
- 同一资料包族最多一个 draft，禁止静默覆盖。
- 确认 draft 时把旧 active 按时间归档，再启用 draft。
- 放弃 draft 时保留 active。
- draft 写入路径越界防护；repository 不提供 active 写入口。

### 私有学习记忆

已经实现：

- 每次学习会话创建一个 pending 记录批次。
- 每道完成的题目写入独立 attempt JSON。
- 同一道题可保存多次提交形成的 `answer_history`。
- 正常结束必须保存非空 `summary.md` 后才能写入 `completed`。
- 用户取消或运行失败时写入 `interrupted`，不伪装成正常结束。
- 读取 pending 批次和现有学习画像。
- 学习画像成功写入后才把选中的 pending 批次移入 archived。
- 画像写入或移动失败时回滚，避免提前消费学习记录。

学习画像的 Agent 生成入口尚未实现；当前完成的是可信存储和消费事务。

### 任务驱动学习

`/study` 当前支持：

- 选择 Profile、章节范围、三种学习方式、五档难度和题型。
- active Profile 资料的代码侧读取和上下文裁剪。
- Agent 出题、语义判题、题目讨论和会话总结。
- 错误后再次作答、讨论后继续作答、主动放弃。
- 解析展示和题目消化确认。
- 下一题、提高难度、更换章节/知识点、查看材料、查看当前总结、结束并保存总结。
- 每题使用代码生成的唯一 ID，避免模型重复 ID 覆盖历史记录。
- 最终总结从本次结构化 attempts 生成，不依赖模型记住完整对话。

### 真实 pi 核心 probe

`npm run probe:sdk-agent` 已在真实 pi 和真实模型中跑通：

```text
prepare_question_context
→ generate_question
→ grade_answer
→ summarize_session
```

验证结果：

- 三张图均到达 `END`。
- 会话最终为 `completed`。
- 磁盘存在一份题目记录和非空总结。
- 出题结果字段类型不合格时，completion validator 成功驳回，Agent 订正后继续。

## 当前自动验证

```text
npm test                    23/23
npm run typecheck           通过
npm run check:docs          通过
npm run smoke:extension     真实 pi/RPC 加载通过
npm run probe:sdk-agent     真实 pi + 模型核心闭环通过
```

## 尚未完成或尚未验收

- 用户人工执行 `/study` 的三种学习方式和全部菜单分支。
- 学习循环的可替换 TUI gateway 与自动状态机 E2E。
- 启动时处理遗留 running 会话和补总结入口。
- 用户手动触发的学习画像生成图。
- 从 Markdown/txt 自动构建完整 canonical Profile。
- 基于 active 的资料包语义修订和质量审查图。
- 10 题以上长会话、compaction、取消、超时和第二模型提供方验证。
- Agent Run、模型 turn 和底层 HTTP 请求的完整成本观测。

这些项目统一由[实施计划](../计划/README.md)管理；其他文档不再承担重复的进度同步责任。
