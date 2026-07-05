import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadProfiles } from "../services/profileService";
import type { LauncherProfile } from "../types/profile";

const STORAGE_KEY = "zzapchoLauncher.selectedProfileId";
const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_COOLDOWN_MS = 5_000;

export function useProfiles() {
  const [profiles, setProfiles] = useState<LauncherProfile[]>([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [loading, setLoading] = useState(true);
  const profilesRef = useRef<LauncherProfile[]>([]);
  const refreshRequest = useRef<Promise<LauncherProfile[]> | null>(null);
  const lastRefreshAt = useRef(0);

  const refreshProfiles = useCallback((force = false): Promise<LauncherProfile[]> => {
    if (refreshRequest.current) return refreshRequest.current;
    if (!force && Date.now() - lastRefreshAt.current < REFRESH_COOLDOWN_MS) {
      return Promise.resolve(profilesRef.current);
    }

    const request = loadProfiles().then((items) => {
      profilesRef.current = items;
      setProfiles(items);
      setSelectedId((current) => items.some((profile) => profile.id === current) ? current : (items[0]?.id ?? ""));
      lastRefreshAt.current = Date.now();
      return items;
    }).finally(() => {
      refreshRequest.current = null;
      setLoading(false);
    });
    refreshRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    void refreshProfiles(true);
    const interval = window.setInterval(() => void refreshProfiles(), REFRESH_INTERVAL_MS);
    const refreshWhenActive = () => void refreshProfiles();
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refreshProfiles]);

  useEffect(() => {
    if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
  }, [selectedId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId),
    [profiles, selectedId],
  );

  return { profiles, selectedProfile, selectProfile: setSelectedId, refreshProfiles, loading };
}
