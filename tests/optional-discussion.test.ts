import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import { describe, expect, it, vi } from "vitest";
import { executeOptionalDiscussion } from "../src/application/optional-discussion.js";

const graph = { id: "study_discuss_question" } as Graph;

function result(status: GraphRunResult["status"], reason?: string): GraphRunResult {
  return {
    graphId: graph.id,
    status,
    result: reason ? { reason } : { reply: "提示", clarified_points: [], lingering_questions: [] },
    steps: 1,
  };
}

describe("executeOptionalDiscussion", () => {
  it("首次图失败时重试一次并返回成功结果", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result("failed", "未调用完成工具"))
      .mockResolvedValueOnce(result("ok"));

    const output = await executeOptionalDiscussion(execute, graph, { revealAnswer: false });

    expect(output).toEqual({
      status: "ok",
      result: { reply: "提示", clarified_points: [], lingering_questions: [] },
    });
    expect(execute).toHaveBeenNthCalledWith(1, graph, { revealAnswer: false, completionAttempt: 1 });
    expect(execute).toHaveBeenNthCalledWith(2, graph, { revealAnswer: false, completionAttempt: 2 });
  });

  it("两次失败后返回 unavailable，不向外抛出中断整场会话", async () => {
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("provider error"))
      .mockResolvedValueOnce(result("failed", "未调用完成工具"));

    await expect(executeOptionalDiscussion(execute, graph, {})).resolves.toEqual({
      status: "unavailable",
      reasons: ["provider error", "未调用完成工具"],
    });
  });
});
