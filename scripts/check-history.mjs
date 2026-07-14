import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const privatePathspecs = [
  ".manual-test",
  "docs/审查/聊天记录.md",
  "docs/审查/聊天记录.txt",
];
const commits = execFileSync(
  "git",
  ["log", "--all", "--format=%H", "--", ...privatePathspecs],
  { cwd: root, encoding: "utf8" },
).split(/\r?\n/u).filter(Boolean);

if (commits.length > 0) {
  console.error(`Git history still contains private learning data or raw interaction transcripts. Commits affected: ${new Set(commits).size}`);
  process.exitCode = 1;
} else {
  console.log("Git history check passed: no private learning data or raw interaction transcripts found.");
}
