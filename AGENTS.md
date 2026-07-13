# AGENTS.md

本文件给在 `pi-study-helper` 中工作的开发 Agent 提供最短事实入口。保持内容简洁，并随当前实现同步更新。

## 项目定位

Pi Study Helper 是新的主产品，以 `pi-loop-graph-sdk` 的回路图组织学习会话、资料构建和资料修订。

- `C:\Users\25173\Desktop\pi-review-agent` 仅作为功能、交互和验收场景的参考实现。
- 不兼容旧项目的代码结构、命令名、Profile 格式或运行数据。
- `C:\Users\25173\Desktop\pi-loop-graph-extension` 是当前 SDK 源码与文档事实来源。

## 阅读顺序

1. `CONTEXT.md`：稳定领域语言。
2. `docs/README.md`：文档入口。
3. `docs/设计/该项目主要目标.md`：目标和范围。
4. `docs/设计/架构边界.md`：代码、Agent、SDK 和 TUI 的责任边界。
5. `docs/计划/README.md`：当前路线、工时和调用预算。
6. `docs/审查/README.md`：验收门禁与 SDK 反馈规则。

## 当前阶段

阶段 0、0.5、Profile family 基础、P0 至 P4 已完成。P5 `/study-revise` 的代码、112 项自动测试和真实九图 probe 已通过，当前等待连续修改、确认归档、学习和放弃人工验收。

## 开发规则

- 确定性流程、TUI、持久化、路径安全和 schema 校验使用代码实现。
- 代码节点直接调用代码侧业务能力；不得调用当前仅为占位的 `NodeContext.callTool()`。
- 若同一能力也要开放给 Agent，pi tool 只是复用底层实现的适配器，不能成为代码节点的唯一入口。
- 生成题目、语义判题、讨论、总结和资料语义重组使用 Agent Run。
- Agent Run 必须与用户主 TUI 的可见输出隔离；代码只消费结构化结果并决定最终展示。作答或明确放弃前不得向用户显示参考答案、解析或内部执行反馈。
- 题目通过专用 TUI gateway/QuestionView 展示，不能依靠 Agent 自然语言或普通运行通知充当题目界面。
- `submitted_answer`、`gave_up`、`interrupted` 等业务动作由代码和明确 UI 操作确定；Agent 只能作语义判题，不能改写动作类型。
- 正常结束学习会话前必须生成并保存学习情况总结。
- 总结 Agent 只消费代码投影的 `SessionEvidence`；原始答案、答案历史、自我订正、参考答案、解析和来源可以保留审计，但不得进入总结上下文。
- `correct` 才能形成掌握证据；`gave_up` 只表示未获得掌握证据，不能自动判定为薄弱。
- 每题必须记录实际 scope 与 target；跨范围学习通过 Session `scopeHistory` 保留进入顺序。
- 学习画像由用户手动触发并确认；累计统计由代码计算，Agent 只生成语义候选。只有画像成功写入后才能归档被消费记录，取消或失败不得消费 pending。
- 每题完成后立即持久化；异常中断标记为 `interrupted`，不假装正常结束。
- 不把 SDK 当前不支持的并行分支、多 Agent 通讯或会话恢复写成已具备能力。
- SDK 缺口必须有最小复现、trace 或测试证据，再进入 `docs/审查/`。
- 新实现不得从参考实现复制隐含兼容层；只提取产品场景和可验证行为。

## 参考验证命令

```powershell
npm test                    # 在本仓库中：当前 112 项测试
npm run typecheck           # 在本仓库中：TypeScript 类型检查
npm run check:docs          # 只检查项目 Markdown，不扫描 node_modules
npm run smoke:extension     # 真实 pi/RPC 加载 extension，不触发模型
npm run probe:sdk-agent     # 真实 pi + 模型：学习、画像、Profile 构建与修订九图闭环
npm test                    # 在 pi-review-agent 中：当前 35 项行为基线
npm test                    # 在 pi-loop-graph-extension 中：当前 286 项 SDK 测试
npm run typecheck           # 在 pi-loop-graph-extension 中
```
