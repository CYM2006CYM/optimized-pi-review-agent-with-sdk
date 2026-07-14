# Pi Study Helper 实施计划

> 状态日期：2026-07-14
>
> 主体实现者：Codex
>
> 计划单位：可独立验收的 Codex 开发轮次，不再以人工开发日为主要估算口径。

## 工作方式

一个“开发轮次”表示我完成一次闭环：

```text
读取当前代码事实
→ 实现一个有边界的功能或修复
→ 添加或更新测试
→ 执行相关验证
→ 更新形态、计划或审查中的必要事实
```

一个轮次不等于一次工具调用，也不等于一次底层模型请求。复杂功能可能连续占用多个对话轮次；估算的作用是控制实施顺序，不是承诺日历时间。

用户主要负责：

- 需要真实 TUI 操作时执行人工测试并返回现象。
- 对无法从现有代码和参考资料推导的产品定义作最终决定。
- 决定是否接受阶段性产品行为。

其余设计、实现、测试、诊断和必要文档同步由我负责。

## 最小文档责任

后续默认只维护三份状态文档：

| 文档                           | 唯一责任                                     |
| ------------------------------ | -------------------------------------------- |
| [当前形态](../形态/README.md)   | 已经由代码或测试证明的事实                   |
| 本计划                         | 下一步顺序、剩余轮次和退出条件               |
| [审查与验收](../审查/README.md) | 人工/自动验证结果、发布门禁和可复现 SDK 问题 |

除非产品定义或架构边界发生实质变化，否则不主动整理 `docs/参考`、`docs/归档`、历史 issue、`draft.md` 或其他重复状态说明。它们即使过期，也不能打断当前实现。

## 里程碑一目标

里程碑一是一个完整纵向产品，不再把基础 Profile 创建和修订推迟到另一个里程碑。完成范围包括：

- Profile family 生命周期。
- Markdown/txt 自动创建 canonical Profile。
- 基于 active 创建 revision draft、反复修改、质量审查、确认或放弃。
- 三种任务驱动学习方式。
- 出题、重答、放弃、解析、讨论和题后功能菜单。
- 逐题记录、异常中断和强制会话总结。
- 用户手动生成学习画像，成功后消费 pending 记录。
- 真实 pi、长会话和关键失败分支验收。

## 当前基线

已经完成：

- 工程骨架和固定 SDK Git 构建产物。
- Profile schema、family repository、demo seed 和 draft/active/archive 生命周期。
- 私有学习记录批次、逐题保存、总结和学习画像消费事务。
- `/study` 的任务驱动学习主循环。
- 出题、判题、讨论、总结四类 Agent 图。
- 真实 pi 核心 probe。
- 117 项自动测试、类型检查、文档链接检查和 extension smoke。
- 四类 Agent 图的隔离 in-memory Session 执行器、专用 QuestionView/TUI gateway 和确定性 Attempt outcome。
- 三种 mode 的代码级目标选择与材料门禁、固定难度 rubric、题目级 target/scope、Session `scopeHistory` 和受控 `SessionEvidence`。

第一轮真实人工 E2E 已执行；本地私有数据与原始交互记录不进入开源仓库。汇总证据为：14 次 graph 全部 `ok`，17 次 completion 提交中 14 次接受、3 次 schema 拒绝后成功订正。

P0 至 P5 的产品功能人工验收均已关闭。当前进入 P6 稳定验收与开源前准备。

## 剩余实施轮次

### P0：恢复测验有效性与可信记录

状态：完成。P0 人工清单 A、B、C、D 均通过。

1. [X] 把出题、判题、讨论和总结 Agent Run 放入隔离/隐藏执行会话，只把结构化结果返回产品代码。
2. [X] 建立专用 QuestionView 和 TUI gateway，固定展示题号、范围、学习方式、难度、题干、选项和答题状态。
3. [X] 建立“作答或放弃前绝不显示参考答案、解析和来源”的自动回归门禁。
4. [X] 只有代码识别 `/giveup` 或明确选择动作时才记录 `gave_up`；普通文本始终作为答案提交。
5. [X] 从用户主 Session 移除 Loop Graph Runtime，隔离内部 Agent 文本、SDK 工具反馈和图完成通知。
6. [X] A、B、C、D 的真实 TUI、磁盘和 trace 证据均已确认。

退出条件：

- 用户作答前看不到参考答案、解析或 Agent 内部执行文本。
- 用户始终能明确看到当前待答题目及其答题状态。
- `gave_up`、`submitted_answer` 和 `interrupted` 只由代码动作决定。
- A、B、C、D 复测均有磁盘、trace 和用户侧证据。

### P1：模式、难度与总结语义加固

状态：完成。产品功能、mode、材料门禁、target/scope 和受控总结输入均已通过；总结措辞的进一步证据约束不作为当前功能还原阻塞。

1. [X] 为 `practice`、`card_practice`、`chapter_study` 定义不同的代码级进入、展示和推进方式。
2. [X] 向出题和总结 Agent 提供固定 difficulty rubric，禁止自行猜测 `S-R/S-U/M-U/M-A/C-A` 含义或产生无效等级。
3. [X] 将总结拆成可观察事实、掌握证据、未获证据和建议；`gave_up` 不自动等同于薄弱。
4. [X] 在 Attempt 保存题目级范围和目标，Session 保存 `scopeHistory`，避免换范围后覆盖历史。
5. [X] 保留原始回答用于审计，同时只向总结 Agent 提供受长度限制、去重和一致性校验的 `SessionEvidence`。
6. [X] 人工验证三种 mode、目标切换、材料视图、Attempt target 和 `scopeHistory`。
7. [X] 用户接受当前总结产品行为，不把进一步措辞约束作为 P1 阻塞。

退出条件：三种模式不只是提示词字符串；难度、范围和总结都能从 repository 事实验证，放弃不再自动等同于薄弱。

### P2：学习状态机与恢复加固

状态：完成。自动测试与 P2 人工清单 A、B、C 全部通过。

1. [X] 从 extension handler 中提取可测试的 `StudySessionController` 和完整 UI port。
2. [X] 为正确、错误、重答、放弃、取消和题后失败添加状态机测试。
3. [X] 增加启动时遗留 running 会话提示和 `/study-recover` 补总结/中断入口。
4. [X] 明确取消、缺少模型、总结失败和持久化失败的状态与用户提示。
5. [X] 真实 Pi 验证 `/study` 无回归，并用现有 P1 C batch 完成一次补总结。

退出条件：主要交互分支不再只能依赖人工点击验证；每题保存和最终总结门禁有自动回归测试。

### P3：手动学习画像

状态：完成。自动测试、真实五图 probe 与 P3 人工清单 A、B、C 全部通过。

1. [X] `/study-profile` 列出未消费的 completed/interrupted pending 学习批次。
2. [X] 建立学习画像 Agent 图、输出 schema 和长度校验。
3. [X] 由代码合并累计统计与已有画像，用户确认后写入 `learning_profile.json`。
4. [X] 仅在画像成功写入后归档被消费批次。
5. [X] 自动测试覆盖 Agent 失败、用户取消和多批次部分移动回滚。
6. [X] 真实 Pi 验证候选预览、确认写入、pending 归档和再次执行无记录提示。

退出条件：用户可以手动生成画像；失败时 pending 记录保持不变。

### P4：原始资料自动创建 Profile

状态：完成。代码、99 项自动测试、extension smoke、真实六图 Agent probe 与 P4 人工清单 A、B、C 全部通过。

1. [X] 代码盘点 Markdown/txt、计算 hash、限制路径并按上下文预算分批。
2. [X] 建立构建 job/checkpoint，不依赖恢复 SDK 图会话。
3. [X] Agent 只提取受控批次的章节、小节、知识点和来源关系。
4. [X] 代码组装完整 canonical 文件、写入唯一 draft 并执行 schema 校验。
5. [X] 生成包含结构指标、来源覆盖和 Agent 语义警告的质量报告。
6. [X] 提供确认启用、保留 draft、放弃并删除 draft 三个出口。
7. [X] 真实 Pi 验证创建、启用、新 Profile 学习和放弃删除出口。

退出条件：给定一组中型 Markdown/txt，可以生成并启用一个新的 canonical Profile。

### P5：Profile 修订闭环

状态：完成。A 复测确认实际 diff 与启用归档正常，C 放弃出口通过；B 的 interrupted 补总结入口按用户决定进入 P6。

1. [X] 从 active 复制 revision draft，已有 draft 直接继续。
2. [X] 收集自然语言反馈，含糊时先澄清，并生成最小影响计划。
3. [X] 补丁只能覆盖计划路径，在 staging 中原子应用；无关文件保持不变。
4. [X] 执行代码结构门禁和独立 Agent 质量审查，阻塞项禁止启用。
5. [X] 用户可继续修改、保留、确认启用归档旧 active 或放弃 draft。
6. [X] 陈旧 revision、越权路径、损坏 JSON、Agent 失败和符号链接有明确防护。
7. [X] 真实 Pi 验证连续修改、实际 diff、确认归档和放弃出口。
8. [X] 实际文件 diff 由代码计算并二次确认；相对 active 无净变化时禁止启用。
9. [X] 必需总结首次没有形成 completion 时，在全新隔离会话自动重试一次。

退出条件：修订永远不直接写 active，且确认、继续修改、放弃三个出口都有测试证据。

### P6：里程碑一稳定验收

预计：3～5 个开发轮次。

1. 10 题以上长会话与 repository 总结一致性。
2. [X] `/study-recover` 可选择 interrupted 且有 attempt、无 summary 的批次补总结；明确中断但零题的记录不进入。自动测试已通过，等待真实 Pi 复核。
3. compaction、取消、Agent 超时、schema 重试和 TUI 关闭。
4. Profile 构建/修订 job 的取消和 checkpoint 重启。
5. 第二模型提供方验证，或明确记录只支持已验证提供方。
6. 汇总 Agent Run、节点访问、失败原因和可观测性缺口。

开源前非文档准备：

1. [X] `.manual-test`、trace、checkpoint、原始聊天/思维记录和凭据文件加入忽略规则。
2. [X] 本地人工数据从 Git 跟踪与 npm pack 中移除，但保留本机文件。
3. [X] 增加 MIT LICENSE、换行规则和 npm 运行文件白名单。
4. [X] 增加 tracked 文件/常见密钥/固定 SDK commit/发布必需文件检查。
5. [X] 增加 Windows/Linux GitHub Actions、生产/完整依赖审计和 dry-run pack；Vitest 升级至 4.1.10 后完整依赖树为 0 漏洞。
6. [X] 在临时干净 clone 中执行 `npm ci`、`npm run verify` 和最小 pack 复核，117 项测试与 42 文件 pack 通过。
7. [ ] Git 历史仍有 5 个提交包含人工数据或原始交互记录；开源前必须经用户决定重写历史或建立干净公开仓库。
8. [ ] 开源文档、仓库元数据和最终发布决定另行处理，不混入本轮非文档准备。

退出条件：[审查门禁](../审查/README.md)中所有里程碑一必需项通过。

## 总体剩余轮次

从当前状态估计，里程碑一还需要约 3～5 个有效开发轮次。

这个范围包括：

- 1 轮 interrupted 补总结真实 Pi 复核与必要修正。
- 1～2 轮长会话、取消、超时、schema 重试、TUI 关闭和 compaction 验收。
- 1 轮 Profile job/checkpoint 与第二模型提供方结论。
- 1 轮干净 clone、历史方案执行后的最终开源门禁。

如果人工 `/study` 一次通过且 Profile 构建输出稳定，轮次会接近下界；如果需要重构 TUI 状态机或 SDK 出现可复现缺口，则接近上界。

## 接下来三轮

1. 用现有 B 批次复核 `/study-recover` 的 interrupted 补总结，并检查 session 变为 completed、summary 非空。
2. 执行 10 题以上长会话与取消、超时、schema 重试、TUI 关闭和 compaction 故障验收。
3. 验证 Profile job/checkpoint 恢复和第二模型提供方，随后完成干净 clone 门禁。

## 运行时 Agent Run 预算

学习会话的实际 Agent Run 为：

```text
Agent Runs = 出题数 Q + 实际答案提交数 A + 讨论轮数 D + 总结次数 S
```

- 首次回答即完成：每题 1 次出题 + 1 次判题。
- 每次重新提交答案增加 1 次判题。
- 主动放弃不调用判题 Agent，直接使用题目已有答案和解析。
- 每轮开放讨论通常增加 1 次 Agent Run；若首次没有形成结构化结果，产品会在新隔离会话中自动重试一次。
- 正常结束至少增加 1 次总结。
- 菜单中查看当前总结每次再增加 1 次总结 Run。

典型示例：

| 场景                         | Agent Runs |
| ---------------------------- | ---------: |
| 1 题首次答对后结束           |          3 |
| 1 题答错一次、重答正确后结束 |          4 |
| 上述过程再讨论一轮           |          5 |
| 10 题均首次完成、无讨论      |         21 |

这只统计 SDK Agent Run，不等于底层 HTTP 请求数。completion validator 驳回、工具 turn 或模型重试可能让一次 Run 产生多次请求。

Profile 构建的基础预算为“源资料批次数 B = B 次 Agent Run”；hash 盘点、canonical 组装、质量指标和 draft 生命周期不调用 Agent。失败批次重试会额外增加对应 Run。

Profile 每轮修订通常为 3 次 Agent Run：影响计划 1 次、受控补丁 1 次、独立质量审查 1 次。反馈需要澄清时，每次重新规划再增加 1 次；继续修改会开始下一组修订 Run。

## 需要用户决定的情况

只有以下情况应暂停实现并询问用户：

- 两种合理行为会显著改变产品体验或数据格式。
- 操作会删除、覆盖或发布用户真实资料。
- 需要扩大到当前里程碑之外的产品范围。
- 同一阻塞经过安全诊断仍无法从代码、测试或参考实现确定答案。

其余实现细节由我作出可逆决定并继续推进。
