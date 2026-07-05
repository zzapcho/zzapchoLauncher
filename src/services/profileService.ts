import localProfiles from "../data/profiles.json";
import type { LauncherProfile } from "../types/profile";

const CONSOLE_MANIFEST_URL = "http://console.zzapcho.kr:3379/api/launcher/profiles";
const MANIFEST_BASE = "https://raw.githubusercontent.com";
const MANIFEST_PATH = "/zzapcho/zzapchoLauncher/codex/rounded-launcher-menu/src/data/profiles.json";
export const PROFILE_MANIFEST_URL = `${MANIFEST_BASE}${MANIFEST_PATH}`;
const PROFILE_CACHE_KEY = "zzapchoLauncher.profileCache";

interface ConsoleManifestResponse {
  profiles?: unknown;
}

function isProfile(value: unknown): value is LauncherProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LauncherProfile>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.accentColor === "string";
}

function normalizeProfile(profile: LauncherProfile): LauncherProfile {
  return {
    ...profile,
    javaVersion: profile.javaVersion ?? 21,
    defaultServer: profile.defaultServer ?? { name: "zzapcho Server", address: "mc.zzapcho.kr", port: 25565 },
    editableFields: { server: false, ...profile.editableFields },
  };
}

async function loadFromConsole(): Promise<LauncherProfile[] | null> {
  try {
    const response = await fetch(`${CONSOLE_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Console manifest request failed: ${response.status}`);
    const manifest = await response.json() as ConsoleManifestResponse | unknown[];
    const profiles = Array.isArray(manifest) ? manifest : manifest.profiles;
    if (Array.isArray(profiles) && profiles.length > 0 && profiles.every(isProfile)) return profiles.map(normalizeProfile);
  } catch (error) {
    console.warn("콘솔 manifest를 불러오지 못해 GitHub manifest를 시도합니다.", error);
  }
  return null;
}

async function loadFromGitHub(): Promise<LauncherProfile[] | null> {
  try {
    const response = await fetch(`${PROFILE_MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
    const manifest: unknown = await response.json();
    if (Array.isArray(manifest) && manifest.length > 0 && manifest.every(isProfile)) return manifest.map(normalizeProfile);
  } catch (error) {
    console.warn("원격 manifest를 불러오지 못해 로컬 프로필을 사용합니다.", error);
  }
  return null;
}

export async function loadProfiles(): Promise<LauncherProfile[]> {
  const consoleProfiles = await loadFromConsole();
  if (consoleProfiles?.length) {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(consoleProfiles)); }
    catch { /* The bundled fallback remains available when storage is unavailable. */ }
    return consoleProfiles;
  }
  const bundled = (localProfiles as LauncherProfile[]).map(normalizeProfile);
  if (bundled.length) return bundled;
  return await loadFromGitHub() ?? [];
}
