# 当前形态

> 状态日期：2026-07-13

Pi Study Helper 已完成阶段 0（工程骨架）与阶段 0.5（SDK 包边界修复）。extension 可由真实 pi 加载，typecheck、测试、依赖树和生产依赖审计均通过。

## 已完成

- 确认新项目为主项目，旧 Pi Review Agent 只作参考且不兼容。
- 确认先交付学习会话闭环，再交付 Profile 构建与修订闭环。
- 确认每题默认两次必要 Agent Run，正常会话结束额外一次总结 Run。
- 确认每题即时归档；异常中断可补总结但不恢复原图位置。
- 确认 `NodeContext.callTool()` 不作为实现依赖；代码节点直接调用代码侧业务能力。
- 建立文档目录、领域语言、架构边界、实施计划和审查门禁。
- 核对参考仓库测试基线：Pi Review Agent 35/35 通过；Loop Graph SDK 原基线 285/285，通过包入口回归后为 286/286，且 typecheck 通过。
- **阶段 0 完成**：TypeScript package、pi extension 脚手架、vitest 测试框架、核心领域类型定义。
  - `npm test`：10/10 通过
  - `npm run typecheck`：通过
  - `npm run check:docs`：项目文档本地链接通过
  - extension 入口注册 `/study` 命令（Phase 1 实现完整 handler）
  - Loop Graph SDK 运行时已接入（静态强类型导入）
- **阶段 0.5 完成**：SDK 公共入口改为编译产物，并以固定 tarball 接入。
  - pi、pi-tui 与 TypeBox 开发版本已固定
  - `npm ls` 通过，无 `ELSPROBLEMS`
  - `npm run smoke:extension`：真实 pi/RPC 加载通过
  - `npm audit --omit=dev --audit-level=high`：0 个生产依赖漏洞
  - SDK 包入口问题已形成可复现审查报告

## 尚未完成

- 新 Profile 与运行数据 schema（阶段 2）。
- TUI gateway + 代码侧业务能力 + 程序化 `executeGraph()` 接入 spike（阶段 1）。
- 学习会话图、Profile 构建图与修订图。
- 本仓库自己的 integration、E2E 和文档一致性检查。

详细任务与用时见 [实施计划](../计划/README.md)。在代码和测试证明之前，不得把计划内容移动到“已完成”。
