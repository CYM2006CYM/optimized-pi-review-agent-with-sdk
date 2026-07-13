# Pi Study Helper 重构实施计划

> 基线日期：2026-07-13  
> 估算口径：1 名熟悉 TypeScript/pi 的开发者 + 编码 Agent；每周 5 个有效开发日；不包含等待外部 SDK 发布的日历时间。

## 结论

- 4～6 个开发日可完成 walking skeleton，验证 TUI gateway、代码侧业务能力、Agent 节点和持久化的最短闭环。
- 19～27 个开发日可交付里程碑一“学习会话闭环”，约 4～6 个日历周。
- 再投入 17～23 个开发日可交付里程碑二“Profile 构建与修订闭环”。
- 完整范围合计约 36～50 个开发日，即单人约 8～11 个日历周。
- 若真实 pi 验证发现 ExtensionContext 无法在程序化图执行期间安全使用，或 SDK 需要修复生命周期/compaction 问题，预留额外 5～10 个开发日；这是当前最大不确定性。`callTool()` 不计入等待项。

两人协作预计只能缩短约 20%～30%，不能减半：图契约、TUI 会话和 SDK 集成集中在同一条关键路径上。

## 范围与发布顺序

### 里程碑一：学习会话闭环

完成三种学习场景、题目生成、答题、判题、归档、题后动作、讨论和强制会话总结。Profile 首版只需要一份符合新 schema 的内置 fixture 和只读 loader，不做旧格式导入。

### 里程碑二：Profile 构建与修订闭环

完成新 Profile 的创建、分批生成、质量审查、修订、启用和失败诊断。

## 分阶段计划与工时

| 阶段 | 主要交付 | 工时 | 退出条件 |
| --- | --- | ---: | --- |
| 0. 工程骨架 | package、extension、测试框架、文档链接检查、固定 SDK 依赖方式 | 2～3 天 | 空 extension 可加载，CI/本地检查可运行 |
| 1. SDK/TUI walking skeleton | 自定义 `/study`、会话 service gateway、程序化 `executeGraph()`、代码侧业务能力、1 个 Agent node + trace | 2～3 天 | 真实 pi 中能交互、完成并清理；失败可见 |
| 2. 新领域与数据基础 | Profile/session/attempt/summary schema、repository、幂等写入、fixture | 4～5 天 | schema 与 repository 单测通过；不依赖旧格式 |
| 3. 单题学习回路 | 材料、生成、答题、判题、归档、题后动作，三种模式 | 6～8 天 | 每题两次必要 Agent Run；归档不可绕过 |
| 4. 会话循环与总结 | next/discuss/summary 路由、强制总结、学习画像、interrupted 检测与补总结 | 3～4 天 | 正常 END 必有 summary；异常题目不丢 |
| 5. M1 稳定与 SDK 反馈 | 真实模型矩阵、compaction/取消/超时、E2E、trace、文档 | 2～4 天 | M1 审查门禁全部通过 |
| 6. 新 Profile 契约 | 源资料、内容索引、材料、来源、质量报告 schema 与 validator | 3～4 天 | fixture 和错误样例可稳定校验 |
| 7. Profile 构建图 | 盘点、分批提取、结构合成、内容生成、代码校验、语义审查 | 6～8 天 | 中型资料集能生成可学习 draft |
| 8. Profile 修订与启用 | 影响分析、局部重建、质量回归、显式启用 | 4～6 天 | 不相关内容不重写；失败 draft 不启用 |
| 9. M2 稳定与发布 | 大资料预算、失败恢复、E2E、SDK 反馈、使用文档 | 4～5 天 | 全范围审查门禁通过 |

阶段 1 是 stop/go gate。若 gateway 不能稳定保有 TUI 上下文，不应继续堆业务图，应先产出最小复现并调整宿主模式或推动上游生命周期修复；不得退回到让 LLM 间接调用确定性工具。

## 里程碑一任务拆分

1. 建立 `src/extension`、`src/graphs`、`src/domain`、`src/services`、`src/repositories` 和 `tests`。
2. 定义 `StudySessionServices` 代码侧业务能力，让图依赖接口而非 pi 全局对象或 `callTool()`。
3. 写最小图并验证 command handler 等待长图执行时，Agent Run 和 TUI input 都能工作。
4. 定义 Profile、Session、Attempt、Question、Grade、Summary 的新 schema。
5. 实现一个内置演示 Profile；只读，不复制旧 Profile family 结构。
6. 实现 `study_session_graph` 的 code/agent 节点与显式 Edge。
7. 为 Agent 节点配置 output schema、校验重试、超时和最小工具白名单。
8. 让 `persist_attempt` 成为题后动作之前的必经节点。
9. 让 `persist_summary` 成为正常 END 之前唯一通路。
10. 启动时扫描 `running` 会话；超龄会话标记为 `interrupted` 并允许补总结。
11. 添加 unit、graph integration、fake-model 和真实 pi E2E。
12. 按审查模板记录 SDK 行为、限制和建议。

## 里程碑二任务拆分

1. 用产品需要重新定义 Profile，而不是从旧 JSON 结构倒推。
2. 代码先盘点源文件、计算 hash、分批并记录来源；Agent 不自行遍历任意路径。
3. 每个 Agent 输出都经过 schema 校验后写入 draft workspace。
4. 构建过程使用 checkpointed job 数据记录已完成批次；这是产品任务恢复，不是恢复 SDK 图会话。
5. 质量检查分为代码检查和 Agent 语义检查，结果分别保存。
6. 修订先计算影响范围，只重建受影响单元。
7. 启用操作检查所有必要证据，不允许 Agent 直接宣称 draft 合格。

## 运行时 Agent Run 预算

### 学习会话

正常基础路径：

```text
Agent Runs = 2 × 题目数 Q + 深度讨论轮数 D + 1 次会话总结
```

| 场景 | Agent Runs | 说明 |
| --- | ---: | --- |
| 1 题后正常结束 | 3 | 生成、判题、总结 |
| 10 题，无讨论 | 21 | 20 次单题语义工作 + 1 次总结 |
| 10 题，2 轮讨论 | 23 | 每轮讨论增加 1 Run |
| 异常会话下次补总结 | +1 | 从已归档事实生成，不恢复原图 |

材料展示、答案输入、归档和题后菜单均为 0 Agent Run 的代码节点。静态 hint 应随题目生成；用户要求开放式提示或追问时才增加 Run。

一个 Agent Run 不等于一次底层 LLM HTTP 请求。正常完成通常需要 1～2 次请求；schema 驳回、completion 重试或工具 turn 可能达到 3 次。首版容量估算按每个 Run 1.5～2 次 API 请求：10 题无讨论约 32～42 次底层请求。上线前必须用 trace 统计 P50/P95，不能长期依赖这个经验值。

### Profile 构建与修订

定义：

- `B`：源资料分批数，按模型有效上下文预算切分。
- `C`：需要生成/整理的内容单元数，建议按章节或主题单元计算。
- `R`：语义质检后的修复轮数，首版限制为 0～2。

初次构建建议预算：

```text
Agent Runs ≈ B（分批提取） + 1（整体结构） + C（内容单元） + 1（语义质检） + R（修复）
```

例如 5 个源批次、8 个章节单元、1 次修复，约 16 次 Agent Run。若每类资产分开生成，调用量会接近 `B + 2C + 2 + R`；首版应优先让一个章节单元一次产出相互一致的材料，降低成本和冲突。

修订建议预算：

```text
Agent Runs ≈ 1（反馈与影响分析） + A（受影响单元） + 1（语义回归） + R
```

其中 `A` 是受影响内容单元数。必须设置每次 job 的最大 Run、最大 token、最大修复轮数和取消信号。

## 模型与运行要求

- 支持稳定 tool use 与结构化 JSON 输出。
- 推荐至少 64k context；资料构建建议 128k，但仍必须主动分批。
- 生成、判题、总结使用独立 output schema，禁止复用宽泛 `Record<string, unknown>` 作为业务验收。
- 生成温度可中等；判题和总结使用较低温度以提高一致性。
- 每个 Agent Run 默认 5 分钟上限只是 SDK 当前值；产品应为节点配置更紧的目标并记录超时。
- 图最大 steps 必须覆盖题目循环，同时另设产品级最大题数，避免无限回路。
- 所有运行串行；不要把调用预算建立在 SDK 未支持的并行分支上。

## 开发 Agent 使用量

建议把实施拆成 18～24 个可独立验收的开发任务。每项通常需要 1 次实现 Agent 会话和 1 次审查/修复会话，整个项目约 30～45 次开发 Agent 会话。高风险的 SDK/TUI、持久化和总结终止条件必须由独立审查任务复核，不能只接受实现 Agent 的自报结果。

## 主要风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| TUI context 无法安全跨图执行 | 阻塞代码节点交互 | 阶段 1 先 spike；调整宿主模式或推动上游生命周期修复 |
| 代码直调缺少 pi tool 事件与 Hook | 观测和审计不完整 | 业务能力统一发出结构化事件，测试副作用与取消语义 |
| compaction 丢失历史题目 | 总结错误 | 总结从 repository 的结构化事实读取 |
| Agent Run 实际请求数失控 | 成本和延迟升高 | schema 简化、trace 计量、重试上限 |
| 单 skill 限制 | 全局规则与阶段规则难组合 | skill provider/renderer 合成，先做验证 |
| 正常退出绕过总结 | 学习画像缺失 | END 只允许从 `persist_summary` 到达 |
| Profile 大资料超上下文 | 构建失败 | 代码分批、checkpoint、单元级生成 |
| SDK 无会话恢复 | 崩溃后图丢失 | 每题归档、interrupted 状态、补总结 |

## 计划完成定义

- 里程碑一和二的用户场景均有自动测试与真实 pi 验收记录。
- 所有正常结束会话都有结构化 Summary 和学习画像更新证据。
- Agent Run 与底层 API 请求量可从 trace 计算。
- 失败、取消、超时和 compaction 场景不会丢失已确认的答题结果。
- SDK 建议均附最小复现或测试，不提交泛化意见。
