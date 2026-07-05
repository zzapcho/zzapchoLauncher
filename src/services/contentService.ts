import type { LauncherProfile } from "../types/profile";
import type { ContentKind, ManagedContentEntry, ProfileContentState } from "../types/content";

const CONTENT_KEY_PREFIX = "zzapchoLauncher.content.";

const emptyState = (): ProfileContentState => ({ mods: [], resourcePacks: [], shaders: [] });

function serverEntries(profile: LauncherProfile, kind: ContentKind): ManagedContentEntry[] {
  return profile[kind].map((entry) => ({ ...entry, source: "server", enabled: true }));
}

function loadUserState(profileId: string): ProfileContentState {
  try {
    const raw = localStorage.getItem(`${CONTENT_KEY_PREFIX}${profileId}`);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<ProfileContentState>;
    return {
      mods: Array.isArray(parsed.mods) ? parsed.mods.filter((entry) => entry.source === "user") : [],
      resourcePacks: Array.isArray(parsed.resourcePacks) ? parsed.resourcePacks.filter((entry) => entry.source === "user") : [],
      shaders: Array.isArray(parsed.shaders) ? parsed.shaders.filter((entry) => entry.source === "user") : [],
    };
  } catch {
    return emptyState();
  }
}

export function getProfileContent(profile: LauncherProfile): ProfileContentState {
  const user = loadUserState(profile.id);
  return {
    mods: [...serverEntries(profile, "mods"), ...user.mods],
    resourcePacks: [...serverEntries(profile, "resourcePacks"), ...user.resourcePacks],
    shaders: [...serverEntries(profile, "shaders"), ...user.shaders],
  };
}

export function saveProfileContent(profileId: string, state: ProfileContentState): void {
  const userOnly: ProfileContentState = {
    mods: state.mods.filter((entry) => entry.source === "user"),
    resourcePacks: state.resourcePacks.filter((entry) => entry.source === "user"),
    shaders: state.shaders.filter((entry) => entry.source === "user"),
  };
  localStorage.setItem(`${CONTENT_KEY_PREFIX}${profileId}`, JSON.stringify(userOnly));
}

export function createUserContent(name: string, fileName?: string, projectId?: string, version = "local"): ManagedContentEntry {
  return {
    id: projectId ? `modrinth-${projectId}` : `local-${Date.now()}-${name}`,
    name,
    version,
    required: false,
    url: "",
    source: "user",
    enabled: true,
    fileName,
    projectId,
  };
}

export function validateProfileContent(profile: LauncherProfile): { valid: boolean; enabled: ManagedContentEntry[]; issues: string[] } {
  const state = getProfileContent(profile);
  const entries = [...state.mods, ...state.resourcePacks, ...state.shaders];
  const issues = entries
    .filter((entry) => entry.source === "server" && entry.required && !entry.enabled)
    .map((entry) => `필수 콘텐츠 비활성화: ${entry.name}`);
  return { valid: issues.length === 0, enabled: entries.filter((entry) => entry.enabled), issues };
}
