import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(
  new URL("../src/extension/index.ts", import.meta.url),
);
const piEntry = fileURLToPath(
  import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const piCli = join(dirname(piEntry), "cli.js");
const temporaryDataRoot = mkdtempSync(join(tmpdir(), "pi-study-smoke-"));

const child = spawn(
  process.execPath,
  [
    piCli,
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-session",
    "--extension",
    extensionPath,
    "--mode",
    "rpc",
  ],
  {
    windowsHide: true,
    env: { ...process.env, PI_STUDY_DATA: temporaryDataRoot },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
let settled = false;

const finish = (error) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  child.kill();
  rmSync(temporaryDataRoot, { recursive: true, force: true });
  if (error) {
    console.error(error);
    const output = `${stdout}\n${stderr}`.trim();
    if (output) console.error(output);
    process.exitCode = 1;
    return;
  }
  console.log("pi 已成功解析并初始化 Pi Study Helper extension。");
};

const inspectLines = () => {
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const message = JSON.parse(line);
      if (
        message.type === "response" &&
        message.command === "get_state" &&
        message.success === true
      ) {
        finish();
        return;
      }
    } catch {
      // RPC stdout 以 NDJSON 输出；不完整行等待下一批数据。
    }
  }
};

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  inspectLines();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("error", (error) => finish(`无法启动 pi: ${error.message}`));
child.on("exit", (code, signal) => {
  if (settled) return;
  finish(`pi 在 smoke 响应前退出（code=${code}, signal=${signal ?? "none"}）`);
});

const timeout = setTimeout(() => {
  finish("pi extension smoke probe 在 30 秒内未返回 get_state");
}, 30_000);

child.stdin.write(`${JSON.stringify({ id: "study-smoke", type: "get_state" })}\n`);
