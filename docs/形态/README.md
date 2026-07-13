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

交互式 `/study` 的 P0 人工门禁已经全部通过：题目稳定展示、Agent 内部输出隔离、确定性放弃、取消清理、订正前讨论和 `chapter_study` mode 均有真实 TUI 证据。当前进入 P1 模式、难度与总结语义验收。

## 已实现

### 工程与 SDK 接入

- TypeScript 严格模式、Vitest、文档链接检查和真实 pi/RPC smoke 已建立。
- `pi-loop-graph-sdk` 固定到 Git commit `d9106b9ae6f717cdb348cf743d0ab7f13ebad1aa`。
- 新 SDK 会在首次 Agent turn 前自动注入 `outputSchema` 契约，并区分候选提交、校验拒绝和 Runtime 接受。
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

学习画像的可信存储、消费事务和手动 Agent 生成入口均已实现。

### 手动学习画像

`/study-profile` 当前支持：

- 选择 active Profile，并列出该科目尚未消费的 completed/interrupted 学习记录。
- 选择一条记录或全部可用记录；running 会话不会进入画像输入。
- 画像 Agent 只接收会话总结摘录、受控 `SessionEvidence` 和已有画像，不接收原始答案、参考答案、解析或来源。
- 累计题数、累计正确数、正确率、近期 session 列表由代码合并，Agent 只生成总体概况、掌握证据、薄弱点、待验证主题和建议。
- 用户先看到画像候选预览；只有明确确认后才写入 `_user/learning_profile.json` 并归档被消费批次。
- 用户取消、Agent 失败或多批次移动中途失败时，原画像和 pending 记录保持不变；部分移动会回滚。

### 任务驱动学习

`/study` 当前支持：

- 选择 Profile、章节范围、三种学习方式、五档难度和题型。
- active Profile 资料的代码侧读取，并按整章、单卡片或单小节裁剪 Agent 上下文。
- `practice` 直接出题；`card_practice` 先显示卡片回忆提示，可选择看正文；`chapter_study` 必须先分页浏览小节材料再出题。
- Agent 出题、语义判题、题目讨论和会话总结。
- 错误后再次作答、讨论后继续作答、主动放弃。
- 解析展示和题目消化确认。
- 下一题、提高难度、按 mode 更换章节/卡片/小节、分页查看当前目标材料、查看当前总结、结束并保存总结。
- 每题使用代码生成的唯一 ID，避免模型重复 ID 覆盖历史记录。
- 每个 Attempt 保存实际 `scope` 和 `target`，Session 保存按进入顺序记录的 `scopeHistory`。
- 代码把 session/attempts 投影成受控 `SessionEvidence`；总结 Agent 不接收原始答案、答案历史、自我订正、参考答案、解析或来源。
- `correct` 才产生掌握证据；`gave_up` 只产生“未获得掌握证据”的主题，不能自动改写为薄弱点。

### 真实 pi 核心 probe

`npm run probe:sdk-agent` 已在真实 pi 和真实模型中跑通：

```text
prepare_question_context
→ generate_question
→ grade_answer
→ discuss_question
→ summarize_session
→ update_learning_profile
```

验证结果：

- 五张图均到达 `END`。
- 会话最终为 `completed`。
- 磁盘存在一份题目记录和非空总结。
- 出题结果字段类型不合格时，completion validator 成功驳回，Agent 订正后继续。
- P3 集成后再次运行真实 probe：5 个带输出契约的 Agent Run 全部形成被接受候选，五张图均为 `ok`，会话、attempt、summary 和学习画像候选均正常生成。

### 第一轮人工 `/study` E2E

测试数据位于 `.manual-test/20260713-194501`，完整用户侧记录位于 `docs/审查/聊天记录.txt`。已经证明：

- 14 次 graph 执行全部 `ok`。
- 17 次 completion 提交中，14 次被接受、3 次因 schema 不合格被拒绝；被拒绝后 Agent 能订正并继续。
- `practice` 正常结束时保存逐题记录和非空总结。
- `card_practice` 保存错误、讨论、重答和最终总结。
- 连续三次主动放弃仍能分别保存 attempt 并正常总结。
- 答题阶段取消时会话保存为 `interrupted`，没有伪造 attempt 或 summary。

这轮测试同时确认了当前产品形态的限制：

- Agent Run 与用户主会话共用可见输出，出题阶段会显示内部执行文本、题目概要，部分场景还会在作答前泄漏参考答案和解析。
- 题目只通过普通通知显示，没有稳定的 QuestionView；用户可能看不到明确的“当前待答题目”。
- 普通用户文本可能被 Agent 解释成“放弃”，进而污染 attempt 和会话总结；业务动作尚未完全由代码确定。
- 三种学习方式目前主要是提示词参数，尚未形成三套明确的代码级交互行为。
- 本轮原计划为 `chapter_study` 的用例实际保存为 `practice`，因此 `chapter_study` 尚无真实验收证据。

### 第一轮 E2E 后的 P0 修复

针对上述前三项阻塞，代码已经完成：

- 四类业务图改为通过 SDK 的 in-memory AgentSession 隔离执行；每次 graph call 使用独立 host，并在成功或失败后释放。主 extension 不再在用户 Session 中安装 Loop Graph Runtime。
- 新增 `StudyTuiGateway` 和固定 QuestionView widget。题目在输入/选择期间持续显示，包含题号、范围、学习方式、难度、题型、题干、选项和订正状态。
- QuestionView 使用展示字段白名单，类型上不接收 `correct_answer`、解析或来源；自动测试使用秘密 sentinel 验证这些字段不会进入 widget、输入标题或选择列表。
- 简答、单选和判断题统一返回 `submitted`、`gave_up` 或 `cancelled`。只有精确 `/giveup` 或明确选择“放弃本题”会产生 `gave_up`。
- Attempt 新增确定性 `outcome`；判题 Agent 被明确告知输入一定是 `submitted_answer`，总结 Agent 只能把 `outcome=gave_up` 解释为主动放弃。
- 错误后的继续订正界面只显示中性提示，不直接展示可能包含答案的判题文本。
- 订正前讨论只投影安全题面和中性错误状态；参考答案、解析、来源和原始判题不会进入讨论 Agent。题目结束后的消化讨论才允许完整答案上下文。
- 题目形成 `outcome` 后立即保存 attempt 和 running session 进度；之后即使在题目消化或讨论中取消，已完成题目也不会丢失。
- 出题完成校验会拒绝与用户选择不一致的难度/题型；当前未开放的多选题不会流入 TUI。判断题选项由代码固定，选择题保存规范选项文本而不是 UI 字母前缀。

第二轮人工测试数据位于 `.manual-test/20260713-p0-retest`。初测中 B 的讨论 Agent 没有提交节点结果，导致讨论图 failed；其余题目展示、隔离、放弃、取消和落盘行为符合预期。

针对 B 已增加可选讨论容错：结构化完成要求提升为最高优先级；首次失败自动在新隔离会话中重试一次；两次失败只显示讨论暂不可用并返回当前题目，不再中断学习会话。用户复测确认 B 与真正的 `chapter_study` 用例均通过，P0 退出条件已经满足。

### P1 模式、难度与证据语义

当前代码和自动测试已经证明：

- 五档难度有代码维护的固定学习目标和出题约束；Agent 不再自行解释缩写。
- 三种 mode 有不同的目标选择、材料展示和推进门禁，不再只是提示词参数。
- 卡片题只能使用当前卡片知识点；小节题只能使用当前小节的资料和知识点集合。
- Profile 材料展示会移除内部路径、frontmatter、出题提示和来源章节，并通过最多十行的 MaterialView 分页。
- Attempt 保存题目级 `scope_id/scope_label` 与 `target_kind/target_id/target_label`；跨章节时 Session 追加 `scopeHistory`，不覆盖历史。
- 总结输入由代码生成 `SessionEvidence`，对字符串做长度限制、数组去重限量和脏数据一致性校验。

P1 人工数据 `.manual-test/20260713-p1` 已证明三种 mode、卡片/小节目标切换、Attempt target 和跨章节 `scopeHistory` 正常。C 在总结第一次 schema 拒绝后的订正阶段被提前关闭，因此保留为 `running` 且无 summary；该记录现在可由 P2 的 `/study-recover` 补全。

### P2 学习控制器与恢复

当前代码和自动测试已经证明：

- `/study` 的完整业务循环已从 extension handler 提取为 `StudySessionController`；extension 只负责 Pi 状态检查、图执行器装配和命令注册。
- 首次答对、错误重答、明确放弃、答题取消、最终总结失败和 attempt 持久化失败都有控制器级状态测试。
- 最终总结或其他题后步骤失败时，已保存 attempt 保持不变，会话标记为 `interrupted`。
- 新增 `/study-recover`：可列出 active Profile 下遗留的 `running` 会话，选择补生成总结并完成，或标记为中断。
- 补总结失败不会消费或中断原记录，session 保持 `running`，可以稍后重试。
- 没有题目记录的 running 会话可以直接标记中断，不需要模型。
- Pi 启动时发现遗留 running 会话会显示数量和 `/study-recover` 提示。

P2 真实 Pi 人工测试已通过：最短 `/study` 能正常完成；原 P1 C 的两题跨范围 `chapter_study` batch 已通过 `/study-recover` 补写 summary 并从 running 改为 completed；再次执行恢复命令会正确提示没有未完成会话。

## 当前自动验证

```text
npm test                    85/85
npm run typecheck           通过
npm run check:docs          通过
npm run smoke:extension     真实 pi/RPC 加载通过
npm run probe:sdk-agent     真实 pi + 模型核心闭环通过
```

## 尚未完成或尚未验收

- `/study-profile` 的真实 Pi 确认、写入和归档人工验收。
- 从 Markdown/txt 自动构建完整 canonical Profile。
- 基于 active 的资料包语义修订和质量审查图。
- 10 题以上长会话、compaction、取消、超时和第二模型提供方验证。
- Agent Run、模型 turn 和底层 HTTP 请求的完整成本观测。

这些项目统一由[实施计划](../计划/README.md)管理；其他文档不再承担重复的进度同步责任。
