// ============================================================
//  Pi Study Helper — pi Extension 入口
// ============================================================
//
//  业务 extension 使用方式：
//    pi install <path-to-pi-study-helper>
//    然后 /study 命令启动学习会话
//
//  代码侧业务能力直接调用底层函数，不通过 NodeContext.callTool()。
//  Agent Run 仅用于语义任务：题目生成、判题、讨论和总结。
// ============================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function studyHelperExtension(pi: ExtensionAPI): Promise<void> {
  // 动态导入 SDK，避免两个 node_modules 中 pi-coding-agent 的类型冲突。
  // 在运行时 pi 宿主提供单一 ExtensionAPI 实例，无实际差异。
  const { createLoopGraphExtension } = await import("pi-loop-graph-sdk");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _loop = createLoopGraphExtension(pi as any);

  // 注册学习会话命令（Phase 1 实现完整 handler）
  pi.registerCommand("study", {
    description: "Start a Pi Study Helper learning session",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent is busy. Start study after the current turn finishes.", "warning");
        return;
      }
      ctx.ui.notify("Pi Study Helper v0.1.0 — 工程骨架已加载", "info");
    },
  });

  // 加载通知
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Pi Study Helper Extension 已加载", "info");
  });
}
