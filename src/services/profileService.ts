import localProfiles from "../data/profiles.json";
import type { LauncherProfile } from "../types/profile";

export const PROFILE_MANIFEST_URL = "";

function isProfile(value: unknown): value is LauncherProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LauncherProfile>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.accentColor === "string";
}

export async function loadProfiles(): Promise<LauncherProfile[]> {
  if (PROFILE_MANIFEST_URL) {
    try {
      const response = await fetch(PROFILE_MANIFEST_URL);
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      const manifest: unknown = await response.json();
      if (Array.isArray(manifest) && manifest.every(isProfile)) return manifest;
    } catch (error) {
      console.warn("원격 manifest를 불러오지 못해 로컬 프로필을 사용합니다.", error);
    }
  }
  return localProfiles as LauncherProfile[];
}
