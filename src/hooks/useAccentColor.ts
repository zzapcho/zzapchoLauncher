import { useMemo } from "react";
import { getAccentColor } from "../services/accentService";
import type { LauncherProfile } from "../types/profile";

export function useAccentColor(profile?: LauncherProfile) {
  return useMemo(() => getAccentColor(profile), [profile]);
}
