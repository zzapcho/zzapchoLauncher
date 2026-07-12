import type { ContentEntry } from "./profile";

export type ContentKind = "mods" | "resourcePacks" | "shaders";

export interface ManagedContentEntry extends ContentEntry {
  source: "server" | "user";
  enabled: boolean;
  fileName?: string;
  projectId?: string;
  iconUrl?: string;
  gameVersions?: string[];
}

export type ProfileContentState = Record<ContentKind, ManagedContentEntry[]>;

export interface LauncherUserSettings {
  memoryGb: number;
  javaPaths: Record<string, string>;
  javaVersions: Record<string, number>;
}
