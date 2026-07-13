import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataRoot = await mkdtemp(join(tmpdir(), "pi-study-sdk-agent-"));
const extensionPath = fileURLToPath(new URL("./sdk-agent-probe-extension.ts", import.meta.url));
const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piCli = join(dirname(piEntry), "cli.js");

const child = spawn(
  process.execPath,
  [
    piCli,
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-session",
    "--extension",
    extensionPath,
    "--print",
    "/study-sdk-probe",
  ],
  {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, PI_STUDY_DATA: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

const exit = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("真实 Agent probe 在 9 分钟内未完成"));
  }, 540_000);
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    resolveExit({ code, signal });
  });
});

try {
  let traceRaw;
  try {
    traceRaw = await readFile(join(dataRoot, "traces", "sdk-agent-probe.jsonl"), "utf8");
  } catch (error) {
    throw new Error(
      `probe 没有生成 trace（exit=${exit.code}, signal=${exit.signal ?? "none"}）\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`,
      { cause: error },
    );
  }
  const events = traceRaw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const graphEnds = events.filter((event) => event.type === "graph_end");
  const graphEnd = graphEnds.at(-1);
  const enteredNodes = events.filter((event) => event.type === "node_enter").map((event) => event.nodeId);
  const eventCount = (type) => events.filter((event) => event.type === type).length;
  const runKey = (event) => `${event.graphRunId}:${event.scopeId}:${event.agentRunId}`;
  const contractRuns = new Set(events.filter((event) => event.type === "output_contract.prepared").map(runKey));
  const acceptedRuns = new Set(events.filter((event) => event.type === "completion.accepted").map(runKey));
  const contractRunWithoutAccepted = [...contractRuns].filter((key) => !acceptedRuns.has(key));
  const requiredNodes = ["prepare_question_context", "generate_question", "grade_answer", "discuss_question", "summarize_session", "update_learning_profile", "build_profile_fragment", "plan_profile_revision", "revise_profile_draft", "review_profile_draft"];
  const pendingRoot = join(dataRoot, "profile_families", "demo-review", "_user", "summaries", "pending");
  const batches = await readdir(pendingRoot);
  if (batches.length !== 1) throw new Error(`probe 应产生一个学习记录批次，实际为 ${batches.length}`);
  const batchRoot = join(pendingRoot, batches[0]);
  const session = JSON.parse(await readFile(join(batchRoot, "session.json"), "utf8"));
  const attempts = await readdir(join(batchRoot, "attempts"));
  const summary = await readFile(join(batchRoot, "summary.md"), "utf8").catch(() => "");
  if (
    exit.code !== 0 ||
    graphEnds.length !== 9 ||
    graphEnds.some((event) => event.status !== "ok") ||
    requiredNodes.some((nodeId) => !enteredNodes.includes(nodeId)) ||
    contractRuns.size !== 9 ||
    eventCount("completion.submitted") < 9 ||
    eventCount("completion.validation_started") < 9 ||
    contractRunWithoutAccepted.length > 0 ||
    session.status !== "completed" ||
    attempts.length !== 1 ||
    summary.trim() === ""
  ) {
    throw new Error(
      `probe 未闭环：exit=${exit.code}, signal=${exit.signal ?? "none"}, graphEnds=${JSON.stringify(graphEnds)}, nodes=${enteredNodes.join(",")}, contractRuns=${contractRuns.size}, submitted=${eventCount("completion.submitted")}, validation=${eventCount("completion.validation_started")}, accepted=${eventCount("completion.accepted")}, contractRunWithoutAccepted=${contractRunWithoutAccepted.join(",")}, session=${session.status}, attempts=${attempts.length}, summary=${summary.length}\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`,
    );
  }
  console.log(`真实 pi Agent probe 通过：${enteredNodes.join(" → ")}；9 张图均到达 END；输出契约 Run=${contractRuns.size}；候选提交=${eventCount("completion.submitted")}；候选接受=${eventCount("completion.accepted")}；会话=${session.status}；题目记录=${attempts.length}；总结已保存；学习画像、Profile 构建与修订候选均已生成`);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
