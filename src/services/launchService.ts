import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LauncherProfile, LaunchResult, LaunchStatus } from "../types/profile";
import type { LauncherAccount } from "../types/auth";
import { getManagedProfileContentFiles, getProfileContentSyncItems, validateProfileContent } from "./contentService";
import { getUserSettings } from "../hooks/useUserSettings";
import { appendLog, resetGameLogs } from "./logService";

export interface LaunchProgress {
  status: LaunchStatus;
  message: string;
  progress: number;
}

let contentSyncQueue: Promise<void> = Promise.resolve();

export const isMinecraftRunning = () => invoke<boolean>("minecraft_running");
export const stopMinecraft = () => invoke<void>("stop_minecraft");

export async function launchProfile(
  profile: LauncherProfile,
  account: LauncherAccount,
  onProgress?: (progress: LaunchProgress) => void,
  knownProfiles: LauncherProfile[] = [profile],
): Promise<LaunchResult> {
  resetGameLogs();
  onProgress?.({ status: "checking-profile", message: "프로필 확인 중", progress: 5 });
  appendLog("launcher", `${profile.name} 실행 요청`);
  onProgress?.({ status: "checking-content", message: "모드 확인 중", progress: 10 });
  const contentValidation = validateProfileContent(profile);
  if (!contentValidation.valid) {
    throw new Error(contentValidation.issues.join("\n"));
  }
  onProgress?.({ status: "preparing", message: "Java 확인 중", progress: 15 });
  appendLog("launcher", "Java와 게임 파일 확인 중...");
  const settings = getUserSettings();
  const requestedMemory = Math.round(settings.memoryGb * 1024);
  const maxMemoryMb = Math.max(profile.launchOptions.minMemoryMb, Math.min(profile.launchOptions.maxMemoryMb, requestedMemory));
  await contentSyncQueue.catch(() => undefined);
  const content = getProfileContentSyncItems(profile);
  const managedFiles = getManagedProfileContentFiles(knownProfiles);
  const stopProgress = await listen<LaunchProgress>("launch-progress", (event) => onProgress?.(event.payload));
  let result: { processId: number };
  try {
    result = await invoke<{ processId: number }>("launch_minecraft", {
      request: {
        profileId: profile.id,
        minecraftVersion: profile.minecraftVersion,
        modLoader: profile.modLoader,
        modLoaderVersion: profile.modLoaderVersion,
        javaVersion: settings.javaVersions[profile.id] ?? profile.javaVersion,
        javaPath: settings.javaPaths[profile.id] || null,
        minMemoryMb: Math.min(profile.launchOptions.minMemoryMb, maxMemoryMb),
        maxMemoryMb,
        javaArgs: profile.launchOptions.javaArgs,
        content,
        managedFiles,
        account,
      },
    });
  } finally {
    stopProgress();
  }
  onProgress?.({ status: "running", message: "Minecraft 실행 중", progress: 100 });
  appendLog("launcher", `Minecraft 프로세스 시작 (PID ${result.processId})`);
  return { success: true, message: "Minecraft를 실행했습니다.", profileId: profile.id };
}

export function syncProfileContent(profile: LauncherProfile, knownProfiles: LauncherProfile[]): Promise<void> {
  const request = {
    profileId: profile.id,
    content: getProfileContentSyncItems(profile),
    managedFiles: getManagedProfileContentFiles(knownProfiles),
  };
  const next = contentSyncQueue.catch(() => undefined).then(() => invoke<void>("sync_profile_content", request));
  contentSyncQueue = next;
  return next;
}
