/** 将 canonical Markdown 转为用户学习视图，移除内部元数据和出题提示。 */
export function prepareMaterialForDisplay(material: string): string {
  const lines = material.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inFrontmatter = false;
  let skipInternalSection = false;
  let atDocumentBoundary = true;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^--- 资料：.* ---$/u.test(line.trim())) {
      atDocumentBoundary = true;
      continue;
    }

    if (line.trim() === "---") {
      if (!inFrontmatter) {
        let previousVisible: string | undefined;
        for (let outputIndex = output.length - 1; outputIndex >= 0; outputIndex -= 1) {
          const candidate = output[outputIndex];
          if (candidate !== undefined && candidate.trim() !== "") {
            previousVisible = candidate;
            break;
          }
        }
        if (atDocumentBoundary || previousVisible === undefined || previousVisible.startsWith("# ")) {
          inFrontmatter = true;
          continue;
        }
      } else {
        inFrontmatter = false;
        continue;
      }
    }
    if (inFrontmatter) continue;

    if (/^##\s+(出题提示|来源)\s*$/u.test(line.trim())) {
      skipInternalSection = true;
      continue;
    }
    if (skipInternalSection && /^#{1,2}\s+/u.test(line.trim())) skipInternalSection = false;
    if (skipInternalSection) continue;

    output.push(line);
    if (line.trim() !== "") atDocumentBoundary = false;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
