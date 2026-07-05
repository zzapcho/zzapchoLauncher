import { invoke } from "@tauri-apps/api/core";

export interface JavaRuntimeInfo {
  path: string;
  major: number;
  source: string;
  compatible: boolean;
}

export function recommendedJavaMajor(minecraftVersion: string): number {
  const [, minor = 0, patch = 0] = minecraftVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  return minor >= 17 ? 17 : 8;
}

export async function discoverJavaRuntimes(requiredMajor: number): Promise<JavaRuntimeInfo[]> {
  return invoke<JavaRuntimeInfo[]>("discover_java_runtimes", { requiredMajor });
}

export async function downloadJavaRuntime(major: number): Promise<string> {
  return invoke<string>("ensure_java_runtime", { major });
}
