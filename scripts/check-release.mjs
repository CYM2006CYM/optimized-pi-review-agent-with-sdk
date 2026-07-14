import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (packageJson.license !== "MIT") errors.push("package.json license 必须为 MIT");
if (packageJson.private !== true) errors.push("开源仓库准备阶段必须保留 private=true，避免误发布 npm");
for (const required of ["src", "fixtures/profiles", "LICENSE"]) {
  if (!packageJson.files?.includes(required)) errors.push(`package.json files 缺少 ${required}`);
}
for (const dependency of Object.values(packageJson.dependencies ?? {})) {
  if (typeof dependency === "string" && /^(?:file|link):/u.test(dependency)) {
    errors.push(`生产依赖不能使用本机路径：${dependency}`);
  }
}
const sdkDependency = packageJson.dependencies?.["pi-loop-graph-sdk"];
if (typeof sdkDependency !== "string" || !/#[0-9a-f]{7,40}$/u.test(sdkDependency)) {
  errors.push("pi-loop-graph-sdk 必须固定到 Git commit");
}

for (const requiredPath of ["LICENSE", "src/extension/index.ts", "fixtures/profiles/demo-review/profile.json", "package-lock.json"]) {
  try {
    await stat(resolve(root, requiredPath));
  } catch {
    errors.push(`缺少发布必需文件：${requiredPath}`);
  }
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbiddenTracked = [
  ["本地人工测试数据", /^\.manual-test\//u],
  ["环境变量文件", /(?:^|\/)\.env(?:\.|$)/u],
  ["运行 trace", /(?:^|\/)traces\/|\.jsonl$/u],
  ["构建 checkpoint", /(?:^|\/)profile_build_jobs\//u],
  ["原始交互记录", /^docs\/审查\/聊天记录\.(?:md|txt)$/u],
  ["私钥文件", /\.(?:pem|key|p12|pfx)$/iu],
];
for (const path of tracked) {
  for (const [label, pattern] of forbiddenTracked) {
    if (pattern.test(path)) errors.push(`${label}不应被 Git 跟踪：${path}`);
  }
}

const secretPatterns = [
  ["private-key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/u],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/u],
];
for (const path of tracked) {
  let content;
  try {
    content = await readFile(resolve(root, path), "utf8");
  } catch {
    continue;
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) errors.push(`疑似 ${label}：${path}`);
  }
}

if (errors.length > 0) {
  console.error(`开源前检查失败：\n- ${[...new Set(errors)].join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`开源前检查通过：${tracked.length} 个 tracked 文件未发现私有运行数据、原始交互记录或常见密钥。`);
}
