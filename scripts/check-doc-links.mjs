import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);
const markdownFiles = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      markdownFiles.push(path);
    }
  }
}

await collect(root);

const broken = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const pathPart = rawTarget.split("#", 1)[0];
    if (!pathPart) continue;
    const target = resolve(dirname(file), decodeURIComponent(pathPart));
    try {
      await access(target);
    } catch {
      broken.push(`${file.slice(root.length + 1)} -> ${rawTarget}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`发现 ${broken.length} 个无效本地 Markdown 链接：`);
  for (const item of broken) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`已检查 ${markdownFiles.length} 个项目 Markdown 文件，本地链接全部有效。`);
