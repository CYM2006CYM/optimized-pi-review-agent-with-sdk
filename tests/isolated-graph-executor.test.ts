import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
  Graph,
  GraphExecutionHost,
  GraphRunRequest,
  GraphRunResult,
  IsolatedGraphSessionFactory,
  IsolatedGraphSessionFactoryOptions,
} from "pi-loop-graph-sdk";
import { describe, expect, it, vi } from "vitest";
import { createIsolatedGraphExecutor } from "../src/graphs/isolated-graph-executor.js";

const graph = { id: "test_graph" } as Graph;
const result: GraphRunResult = {
  graphId: "test_graph",
  status: "ok",
  result: { value: 1 },
  steps: 1,
};

function commandContext(options: { model?: unknown } = {}): ExtensionCommandContext {
  const authStorage = { source: "shared-auth" };
  const modelRegistry = { authStorage };
  const model = Object.hasOwn(options, "model")
    ? options.model
    : { provider: "test", id: "test-model" };
  return {
    cwd: "C:\\workspace",
    model,
    modelRegistry,
    signal: undefined,
  } as unknown as ExtensionCommandContext;
}

function unusedSessionFactory(): IsolatedGraphSessionFactory {
  return async () => {
    throw new Error("fake host 不应创建真实 session");
  };
}

describe("createIsolatedGraphExecutor", () => {
  it("缺少当前模型时立即失败", () => {
    const createSessionFactory = vi.fn();

    expect(() => createIsolatedGraphExecutor(
      commandContext({ model: undefined }),
      {},
      { createSessionFactory },
    )).toThrow("请先选择可用模型再开始学习");
    expect(createSessionFactory).not.toHaveBeenCalled();
  });

  it("复用命令上下文的认证和模型，并发送 delegate 请求", async () => {
    const ctx = commandContext();
    const signal = new AbortController().signal;
    const traceSink = vi.fn();
    Object.defineProperty(ctx, "signal", { get: () => signal });
    let factoryOptions: IsolatedGraphSessionFactoryOptions | undefined;
    let receivedGraph: Graph | undefined;
    let receivedRequest: GraphRunRequest | undefined;
    const dispose = vi.fn(async () => undefined);
    const host: GraphExecutionHost = {
      async run(nextGraph, request) {
        receivedGraph = nextGraph;
        receivedRequest = request;
        return result;
      },
      dispose,
    };

    const execute = createIsolatedGraphExecutor(
      ctx,
      { traceSink, limits: { rootMaxSteps: 7 } },
      {
        createSessionFactory(options) {
          factoryOptions = options;
          return unusedSessionFactory();
        },
        createHost: () => host,
      },
    );
    const params = { subjectId: "demo-review" };

    await expect(execute(graph, params)).resolves.toEqual(result);
    expect(factoryOptions).toMatchObject({
      cwd: ctx.cwd,
      authStorage: ctx.modelRegistry.authStorage,
      modelRegistry: ctx.modelRegistry,
      model: ctx.model,
      thinkingLevel: "off",
      defaultTools: [],
      traceSink,
      limits: { rootMaxSteps: 7 },
    });
    expect(receivedGraph).toBe(graph);
    expect(receivedRequest).toEqual({
      background: params,
      invocationKind: "command",
      boundary: "delegate",
      signal,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("每次执行创建独立 host 并分别释放", async () => {
    const hosts: Array<{ run: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
    const execute = createIsolatedGraphExecutor(
      commandContext(),
      {},
      {
        createSessionFactory: unusedSessionFactory,
        createHost: () => {
          const host = {
            run: vi.fn(async () => result),
            dispose: vi.fn(async () => undefined),
          };
          hosts.push(host);
          return host;
        },
      },
    );

    await execute(graph, { call: 1 });
    await execute(graph, { call: 2 });

    expect(hosts).toHaveLength(2);
    expect(hosts[0]).not.toBe(hosts[1]);
    expect(hosts[0]?.run).toHaveBeenCalledOnce();
    expect(hosts[1]?.run).toHaveBeenCalledOnce();
    expect(hosts[0]?.dispose).toHaveBeenCalledOnce();
    expect(hosts[1]?.dispose).toHaveBeenCalledOnce();
  });

  it("图执行抛错时仍释放 host", async () => {
    const failure = new Error("graph failed");
    const dispose = vi.fn(async () => undefined);
    const execute = createIsolatedGraphExecutor(
      commandContext(),
      {},
      {
        createSessionFactory: unusedSessionFactory,
        createHost: () => ({
          async run() {
            throw failure;
          },
          dispose,
        }),
      },
    );

    await expect(execute(graph, {})).rejects.toBe(failure);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
