import { invoke } from "@tauri-apps/api/core";
import type { LauncherProfile, LaunchResult, LaunchStatus } from "../types/profile";
import type { LauncherAccount } from "../types/auth";
import { getProfileContent, validateProfileContent } from "./contentService";
import { getUserSettings } from "../hooks/useUserSettings";
import { appendLog, resetGameLogs } from "./logService";

export interface LaunchProgress {
  status: LaunchStatus;
  message: string;
}

export async function launchProfile(
  profile: LauncherProfile,
  account: LauncherAccount,
  onProgress?: (progress: LaunchProgress) => void,
): Promise<LaunchResult> {
  resetGameLogs();
  appendLog("launcher", `${profile.name} 실행 요청`);
  const contentValidation = validateProfileContent(profile);
  if (!contentValidation.valid) {
    throw new Error(contentValidation.issues.join("\n"));
  }
  onProgress?.({ status: "preparing", message: "Java와 게임 파일 확인 중..." });
  appendLog("launcher", "Java와 게임 파일 확인 중...");
  const settings = getUserSettings();
  const requestedMemory = Math.round(settings.memoryGb * 1024);
  const maxMemoryMb = Math.max(profile.launchOptions.minMemoryMb, Math.min(profile.launchOptions.maxMemoryMb, requestedMemory));
  const allContent = getProfileContent(profile);
  const content = (Object.entries(allContent) as Array<[keyof typeof allContent, typeof allContent.mods]>).flatMap(([kind, entries]) =>
    entries.filter((entry) => entry.source === "user" && entry.fileName).map((entry) => ({ kind, fileName: entry.fileName!, enabled: entry.enabled })),
  );
  const result = await invoke<{ processId: number }>("launch_minecraft", {
    request: {
      profileId: profile.id,
      minecraftVersion: profile.minecraftVersion,
      modLoader: profile.modLoader,
      modLoaderVersion: profile.modLoaderVersion,
      javaVersion: profile.javaVersion,
      minMemoryMb: Math.min(profile.launchOptions.minMemoryMb, maxMemoryMb),
      maxMemoryMb,
      javaArgs: profile.launchOptions.javaArgs,
      content,
      account,
    },
  });
  onProgress?.({ status: "running", message: "Minecraft 실행 중" });
  appendLog("launcher", `Minecraft 프로세스 시작 (PID ${result.processId})`);
  return { success: true, message: "Minecraft를 실행했습니다.", profileId: profile.id };
}
