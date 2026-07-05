import { useState } from "react";
import type { LauncherUserSettings } from "../types/content";

const SETTINGS_KEY = "zzapchoLauncher.userSettings";
const DEFAULT_SETTINGS: LauncherUserSettings = { memoryGb: 4, javaPaths: {} };

export function getUserSettings(): LauncherUserSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<LauncherUserSettings> | null;
    return {
      memoryGb: typeof parsed?.memoryGb === "number" ? parsed.memoryGb : DEFAULT_SETTINGS.memoryGb,
      javaPaths: parsed?.javaPaths && typeof parsed.javaPaths === "object" ? parsed.javaPaths : {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useUserSettings() {
  const [settings, setSettings] = useState(getUserSettings);
  const setMemoryGb = (memoryGb: number) => {
    const normalized = Math.min(32, Math.max(.5, Math.round(memoryGb * 2) / 2));
    const next = { ...getUserSettings(), memoryGb: normalized };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };
  const setJavaPath = (profileId: string, javaPath: string) => {
    const current = getUserSettings();
    const next = { ...current, javaPaths: { ...current.javaPaths, [profileId]: javaPath } };
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };
  return { settings, setMemoryGb, setJavaPath };
}
