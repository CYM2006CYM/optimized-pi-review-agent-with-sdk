import type { Graph, GraphRunResult } from "pi-loop-graph-sdk";
import type { IsolatedGraphExecutor } from "../graphs/isolated-graph-executor.js";

export type OptionalDiscussionResult =
  | { status: "ok"; result: Record<string, unknown> }
  | { status: "unavailable"; reasons: string[] };

function failureReason(result: GraphRunResult): string {
  const reason = result.result.reason;
  return typeof reason === "string" && reason.trim() !== ""
    ? reason
    : `图 ${result.graphId} 未正常完成（${result.status}）`;
}

/** 可选讨论最多重试一次；失败不能升级为整场学习中断。 */
export async function executeOptionalDiscussion(
  executeGraph: IsolatedGraphExecutor,
  graph: Graph,
  input: Record<string, unknown>,
): Promise<OptionalDiscussionResult> {
  const reasons: string[] = [];
  for (let completionAttempt = 1; completionAttempt <= 2; completionAttempt += 1) {
    try {
      const result = await executeGraph(graph, { ...input, completionAttempt });
      if (result.status === "ok") return { status: "ok", result: result.result };
      reasons.push(failureReason(result));
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { status: "unavailable", reasons };
}
