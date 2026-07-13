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

当前仅建立设计与实施基线，尚未创建运行时代码。第一产品里程碑先完成学习会话闭环，第二里程碑再完成 Profile 构建与修订闭环。

## 开发规则

- 确定性流程、TUI、持久化、路径安全和 schema 校验使用代码实现。
- 代码节点直接调用代码侧业务能力；不得调用当前仅为占位的 `NodeContext.callTool()`。
- 若同一能力也要开放给 Agent，pi tool 只是复用底层实现的适配器，不能成为代码节点的唯一入口。
- 生成题目、语义判题、讨论、总结和资料语义重组使用 Agent Run。
- 正常结束学习会话前必须生成并保存学习情况总结。
- 每题完成后立即持久化；异常中断标记为 `interrupted`，不假装正常结束。
- 不把 SDK 当前不支持的并行分支、多 Agent 通讯或会话恢复写成已具备能力。
- SDK 缺口必须有最小复现、trace 或测试证据，再进入 `docs/审查/`。
- 新实现不得从参考实现复制隐含兼容层；只提取产品场景和可验证行为。

## 参考验证命令

```powershell
npm test                    # 在本仓库中：当前 8 项骨架测试
npm run typecheck           # 在本仓库中：TypeScript 类型检查
npm test                    # 在 pi-review-agent 中：当前 35 项行为基线
npm test                    # 在 pi-loop-graph-extension 中：当前 285 项 SDK 测试
npm run typecheck           # 在 pi-loop-graph-extension 中
```
