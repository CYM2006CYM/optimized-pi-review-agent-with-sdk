# 当前形态

> 状态日期：2026-07-13

Pi Study Helper 已完成阶段 0（工程骨架）。extension 可加载、typecheck 通过、测试可运行。

## 已完成

- 确认新项目为主项目，旧 Pi Review Agent 只作参考且不兼容。
- 确认先交付学习会话闭环，再交付 Profile 构建与修订闭环。
- 确认每题默认两次必要 Agent Run，正常会话结束额外一次总结 Run。
- 确认每题即时归档；异常中断可补总结但不恢复原图位置。
- 确认 `NodeContext.callTool()` 不作为实现依赖；代码节点直接调用代码侧业务能力。
- 建立文档目录、领域语言、架构边界、实施计划和审查门禁。
- 核对参考仓库测试基线：Pi Review Agent 35/35 通过；Loop Graph SDK 285/285 通过且 typecheck 通过。
- **阶段 0 完成**：TypeScript package、pi extension 脚手架、vitest 测试框架、核心领域类型定义。
  - `npm test`：8/8 通过
  - `npm run typecheck`：通过
  - extension 入口注册 `/study` 命令（Phase 1 实现完整 handler）
  - Loop Graph SDK 运行时已接入（动态导入，避免类型冲突）

## 尚未完成

- 新 Profile 与运行数据 schema（阶段 2）。
- TUI gateway + 代码侧业务能力 + 程序化 `executeGraph()` 接入 spike（阶段 1）。
- 学习会话图、Profile 构建图与修订图。
- 本仓库自己的 integration、E2E 和文档一致性检查。

详细任务与用时见 [实施计划](../计划/README.md)。在代码和测试证明之前，不得把计划内容移动到“已完成”。
