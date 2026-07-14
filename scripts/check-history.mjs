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
  console.error(`Git 历史仍包含本地学习数据或原始交互记录，开源前必须重写历史或建立干净公开仓库。涉及提交数：${new Set(commits).size}`);
  process.exitCode = 1;
} else {
  console.log("Git 历史检查通过：未发现本地学习数据或原始交互记录路径。");
}
