import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  createIsolatedGraphSessionFactory,
  IsolatedSessionGraphHost,
  type Graph,
  type GraphExecutionHost,
  type GraphRunResult,
  type IsolatedGraphSessionFactory,
  type IsolatedGraphSessionFactoryOptions,
  type LoopGraphLimits,
  type LoopGraphTraceSink,
} from "pi-loop-graph-sdk";

export type IsolatedGraphExecutor = (
  graph: Graph,
  params: Record<string, unknown>,
) => Promise<GraphRunResult>;

export interface IsolatedGraphExecutorOptions {
  traceSink?: LoopGraphTraceSink;
  limits?: LoopGraphLimits;
}

/** @internal 仅用于替换会话和 host 构造，以便测试生命周期契约。 */
export interface IsolatedGraphExecutorDependencies {
  createSessionFactory?: (
    options: IsolatedGraphSessionFactoryOptions,
  ) => IsolatedGraphSessionFactory;
  createHost?: (createSession: IsolatedGraphSessionFactory) => GraphExecutionHost;
}

/**
 * 为业务命令创建隔离图执行器。
 *
 * 每次执行都会创建并释放一个新的 in-memory AgentSession，图内的模型消息、
 * completion 工具反馈和 SDK 完成通知不会进入产品主会话。
 */
export function createIsolatedGraphExecutor(
  ctx: ExtensionCommandContext,
  options: IsolatedGraphExecutorOptions = {},
  dependencies: IsolatedGraphExecutorDependencies = {},
): IsolatedGraphExecutor {
  const model = ctx.model;
  if (!model) throw new Error("请先选择可用模型再开始学习");

  const createSessionFactory = dependencies.createSessionFactory ?? createIsolatedGraphSessionFactory;
  const createSession = createSessionFactory({
    cwd: ctx.cwd,
    authStorage: ctx.modelRegistry.authStorage,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel: "off",
    defaultTools: [],
    traceSink: options.traceSink,
    limits: options.limits,
  });
  const createHost = dependencies.createHost
    ?? ((factory: IsolatedGraphSessionFactory) => new IsolatedSessionGraphHost({ createSession: factory }));

  return async (graph, params) => {
    const host = createHost(createSession);
    try {
      return await host.run(graph, {
        background: params,
        invocationKind: "command",
        boundary: "delegate",
        signal: ctx.signal,
      });
    } finally {
      await host.dispose();
    }
  };
}
