import type { LauncherProfile } from "../types/profile";

const FALLBACK_ACCENT = "#8fe388";

export function getAccentColor(profile?: LauncherProfile): string {
  return profile?.accentColor || FALLBACK_ACCENT;
}

export async function extractAccentColorFromImage(_imageUrl: string): Promise<string> {
  // 향후 Canvas 기반 이미지 대표색 추출로 교체할 확장 지점입니다.
  return FALLBACK_ACCENT;
}
