# Loop Graph SDK 能力基线

> 来源：`C:\Users\25173\Desktop\pi-loop-graph-extension`  
> 原始 package：`pi-loop-graph-sdk@0.1.0`；本地包入口修复产物：`0.1.1`
> 核对日期：2026-07-13

## 可用能力

- `createLoopGraphExtension(pi)` 创建实例级运行时并注册/执行 Graph。
- Graph 由 Entry、Node、NodeCompletion、Router、Edge 与 END 组成。
- code node 可运行普通代码，也可通过 `ctx.runAgent()` 发起一次或多次 Agent Run。
- graph node 支持 `call`、`compose`、`delegate` 三种调用边界。
- Edge 显式产生 ContextFrame、后继 NodeInput 和 END output。
- 支持 output schema、自定义完成校验和 `__graph_complete__` 固定完成 ABI。
- Mechanism 可观察生命周期、约束工具、校验完成并保存私有横切状态。
- 支持自定义 context renderer、skill provider、tool resolver、trace sink 和限制配置。
- `executeGraph()` 可程序化执行 Graph，适合由业务自定义命令启动。

## 当前明确不支持

- 并行分支和 fork/join。
- 多 Agent 寻址与通讯。
- 未完成 Graph 的跨进程恢复。
- 同一个 LoopGraphExtension instance 的并发 root `executeGraph()`。

## 接入注意

- 早期基线 commit 的公共入口指向 TypeScript 源码，真实 pi/Jiti 加载会错误解析 `typebox/schema`；详见[SDK 包入口问题报告](../审查/2026-07-13-sdk-package-entry-jiti-resolution.md)。当前主项目固定使用包含编译后公共入口的 Git commit `0a80dd08f163df9ecc2089a3ab7d426b1bb883b3`。
- `NodeContext.callTool()` 只有接口签名，当前 `PiNodeContext` 占位实现会直接抛错。
- pi `ExtensionAPI` 没有 `invokeTool()`；`getAllTools()` 返回的 `ToolInfo` 也不包含 `execute`，所以 SDK 无法桥接执行已注册工具。
- code node 应直接调用代码侧业务能力，而不是调用注册 tool；需要 Agent 使用时，再用薄 tool adapter 复用相同底层函数。
- NodeContext 只有 `signal`、`runAgent` 和未实现的 `callTool`，没有业务命令的 ExtensionContext。
- interactive TUI 应先验证自定义命令 + service gateway + 程序化执行图的宿主方式。
- 带 `invocation` 的 Graph 由 SDK 命令入口按 `delegate` 隔离执行；未配置 `createDelegateHost` 会明确拒绝。产品 `/study` 需要持有同一个 TUI gateway，因此采用自定义 pi command + 程序化 `executeGraph()`，真实 probe 已证明该路径可用。
- 一个 Node 只能声明一个 `skill`；需要验证全局与阶段规则的合成方式。
- `createAgentExecute({ tools })` 中的 tools 已废弃且不生效；工具白名单声明在 Node 上。
- Agent 只看显式 prompt、skill 和渲染后的 frame；`NodeInput.data` 不会自动进入 prompt。
- ContextFrame 是开放业务载荷，不应依赖旧 `nodeId/status/summary/result` 兼容形状。

## 本项目重点验证

1. 长学习循环与 compaction 后的业务事实一致性。
2. TUI gateway 和代码侧业务能力在 code node 生命周期内的安全性。
3. 正常 END 必须经过可信总结持久化。
4. code/agent 混合节点、校验重试、取消和超时。
5. `call`/`compose` 对讨论和总结子图的上下文隔离。
6. Agent Run、turn、工具和失败的可观测成本数据。

## 测试基线

原始基线 `npm test` 通过 285/285；加入包入口回归后通过 286/286，`npm run typecheck` 通过。该结果证明 SDK 自测健康，不替代真实 pi 学习场景的集成验证。

2026-07-13 在固定 commit 上完成真实 pi Agent probe：`prepare_question_context → generate_question → grade_answer → summarize_session`，三张图均正常到达 `END`，并形成 completed 会话、1 题记录和非空总结。出题节点首次返回的字段类型不合格时，SDK 的 completion validator 成功驳回并让 Agent 订正后继续。详见[验证记录](../审查/2026-07-13-study-sdk-core-loop.md)。

## `callTool` 结论

| 路径 | 本项目判断 |
| --- | --- |
| code node 直接 import/注入底层实现 | 当前正式路径 |
| 等待 pi 提供公开 `invokeTool()` | 非首版依赖；未来可重新评估 |
| SDK 保存 ToolDefinition 并自行执行 | 不采用；仍缺有效 ExtensionContext，且复制 pi 工具运行语义 |
| 通过 LLM prompt 间接调用工具 | 不采用；增加延迟、成本和不确定性 |

代码直调不触发 pi tool schema、事件、渲染或 Mechanism 工具 Hook，产品层必须补足校验、取消与可观测性。
