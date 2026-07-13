import { homedir } from "node:os";
import { resolve } from "node:path";

export const STUDY_DATA_ENV = "PI_STUDY_DATA";

/**
 * 获取运行数据根目录。显式参数优先，之后是环境变量，最后落在用户目录。
 * 返回绝对路径，调用方不需要依赖当前工作目录。
 */
export function resolveStudyDataRoot(explicitRoot?: string): string {
  const configured = explicitRoot ?? process.env[STUDY_DATA_ENV];
  return resolve(configured ?? resolve(homedir(), ".pi", "agent", "study-helper-data"));
}

export function profileFamiliesRoot(dataRoot: string): string {
  return resolve(dataRoot, "profile_families");
}
