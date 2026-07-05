import { useEffect, useMemo, useState } from "react";
import { loadProfiles } from "../services/profileService";
import type { LauncherProfile } from "../types/profile";

const STORAGE_KEY = "zzapchoLauncher.selectedProfileId";

export function useProfiles() {
  const [profiles, setProfiles] = useState<LauncherProfile[]>([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfiles().then((items) => {
      setProfiles(items);
      setSelectedId((current) => items.some((profile) => profile.id === current) ? current : (items[0]?.id ?? ""));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
  }, [selectedId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedId),
    [profiles, selectedId],
  );

  return { profiles, selectedProfile, selectProfile: setSelectedId, loading };
}
