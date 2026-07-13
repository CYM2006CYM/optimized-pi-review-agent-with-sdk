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
    reject(new Error("真实 Agent probe 在 6 分钟内未完成"));
  }, 360_000);
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
  const requiredNodes = ["prepare_question_context", "generate_question", "grade_answer", "summarize_session"];
  const pendingRoot = join(dataRoot, "profile_families", "demo-review", "_user", "summaries", "pending");
  const batches = await readdir(pendingRoot);
  if (batches.length !== 1) throw new Error(`probe 应产生一个学习记录批次，实际为 ${batches.length}`);
  const batchRoot = join(pendingRoot, batches[0]);
  const session = JSON.parse(await readFile(join(batchRoot, "session.json"), "utf8"));
  const attempts = await readdir(join(batchRoot, "attempts"));
  const summary = await readFile(join(batchRoot, "summary.md"), "utf8").catch(() => "");
  if (
    exit.code !== 0 ||
    graphEnds.length !== 3 ||
    graphEnds.some((event) => event.status !== "ok") ||
    requiredNodes.some((nodeId) => !enteredNodes.includes(nodeId)) ||
    session.status !== "completed" ||
    attempts.length !== 1 ||
    summary.trim() === ""
  ) {
    throw new Error(
      `probe 未闭环：exit=${exit.code}, signal=${exit.signal ?? "none"}, graphEnds=${JSON.stringify(graphEnds)}, nodes=${enteredNodes.join(",")}, session=${session.status}, attempts=${attempts.length}, summary=${summary.length}\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`,
    );
  }
  console.log(`真实 pi Agent probe 通过：${enteredNodes.join(" → ")}；3 张图均到达 END；会话=${session.status}；题目记录=${attempts.length}；总结已保存`);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
