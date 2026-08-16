import { useEffect, useState } from "react";
import { getProfileContent, saveProfileContent } from "../services/contentService";
import type { ContentKind, ManagedContentEntry, ProfileContentState } from "../types/content";
import type { LauncherProfile } from "../types/profile";

export function useProfileContent(profile: LauncherProfile) {
  const [state, setState] = useState<ProfileContentState>(() => getProfileContent(profile));

  useEffect(() => setState(getProfileContent(profile)), [profile]);

  const update = (kind: ContentKind, updater: (entries: ManagedContentEntry[]) => ManagedContentEntry[]) => {
    setState((current) => {
      const next = { ...current, [kind]: updater(current[kind]) };
      saveProfileContent(profile.id, next);
      return next;
    });
  };

  return {
    state,
    add: (kind: ContentKind, entry: ManagedContentEntry) => update(kind, (entries) => entries.some((item) =>
      item.id === entry.id || Boolean(entry.fileName && item.fileName?.toLocaleLowerCase() === entry.fileName.toLocaleLowerCase())
    ) ? entries : [...entries, entry]),
    toggle: (kind: ContentKind, id: string) => update(kind, (entries) => entries.map((entry) => entry.id === id && !entry.required ? { ...entry, enabled: !entry.enabled } : entry)),
    remove: (kind: ContentKind, id: string) => update(kind, (entries) => entries.filter((entry) => entry.id !== id || entry.source === "server")),
    patch: (kind: ContentKind, id: string, patch: Partial<ManagedContentEntry>) => update(kind, (entries) => entries.map((entry) => entry.id === id && entry.source === "user" ? { ...entry, ...patch } : entry)),
  };
}
