import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (packageJson.license !== "MIT") errors.push("package.json license must be MIT");
if (packageJson.private !== true) errors.push("must keep private=true to prevent accidental npm publish");
for (const required of ["src", "fixtures/profiles", "LICENSE"]) {
  if (!packageJson.files?.includes(required)) errors.push(`package.json files missing ${required}`);
}
for (const dependency of Object.values(packageJson.dependencies ?? {})) {
  if (typeof dependency === "string" && /^(?:file|link):/u.test(dependency)) {
    errors.push(`production dependency uses local path: ${dependency}`);
  }
}
const sdkDependency = packageJson.dependencies?.["pi-loop-graph-sdk"];
if (typeof sdkDependency !== "string" || !/#[0-9a-f]{7,40}$/u.test(sdkDependency)) {
  errors.push("pi-loop-graph-sdk must be pinned to a Git commit hash");
}

for (const requiredPath of ["LICENSE", "src/extension/index.ts", "fixtures/profiles/demo-review/profile.json", "package-lock.json"]) {
  try {
    await stat(resolve(root, requiredPath));
  } catch {
    errors.push(`required file missing: ${requiredPath}`);
  }
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbiddenTracked = [
  ["local test data", /^\.manual-test\//u],
  ["env files", /(?:^|\/)\.env(?:\.|$)/u],
  ["trace files", /(?:^|\/)traces\/|\.jsonl$/u],
  ["build checkpoint", /(?:^|\/)profile_build_jobs\//u],
  ["chat transcripts", /^docs\/审查\/聊天记录\.(?:md|txt)$/u],
  ["private keys", /\.(?:pem|key|p12|pfx)$/iu],
];
for (const path of tracked) {
  for (const [label, pattern] of forbiddenTracked) {
    if (pattern.test(path)) errors.push(`${label} should not be tracked: ${path}`);
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
    if (pattern.test(content)) errors.push(`possible ${label}: ${path}`);
  }
}

if (errors.length > 0) {
  console.error(`Release check failed:\n- ${[...new Set(errors)].join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Release check passed: ${tracked.length} tracked files, no private data or secrets found.`);
}
