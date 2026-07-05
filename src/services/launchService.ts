import type { LauncherProfile, LaunchResult, LaunchStatus } from "../types/profile";
import { validateProfileContent } from "./contentService";

export interface LaunchProgress {
  status: LaunchStatus;
  message: string;
}

const wait = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, duration));

export async function launchProfile(
  profile: LauncherProfile,
  onProgress?: (progress: LaunchProgress) => void,
): Promise<LaunchResult> {
  const contentValidation = validateProfileContent(profile);
  if (!contentValidation.valid) {
    throw new Error(contentValidation.issues.join("\n"));
  }
  const steps: LaunchProgress[] = [
    { status: "preparing", message: "준비 중..." },
    { status: "checking-profile", message: "프로필 확인 중..." },
    { status: "checking-content", message: "모드와 리소스팩 확인 중..." },
    { status: "ready", message: "실행 준비 완료" },
  ];

  for (const step of steps) {
    onProgress?.(step);
    await wait(500);
  }

  console.info("[zzapcho Launcher] launch stub", {
    profile,
    enabledContent: contentValidation.enabled,
    futureLaunchPipeline: ["Microsoft 인증", "Java 확인", "게임/로더 설치", "콘텐츠 동기화", "서버 등록", "Minecraft 프로세스 실행"],
  });

  return { success: true, message: "아직 실제 실행은 연결되지 않았어요.", profileId: profile.id };
}
