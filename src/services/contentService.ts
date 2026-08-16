import type { LauncherProfile } from "../types/profile";
import type { ContentKind, ManagedContentEntry, ProfileContentState } from "../types/content";

const CONTENT_KEY_PREFIX = "zzapchoLauncher.content.";

const emptyState = (): ProfileContentState => ({ mods: [], resourcePacks: [], shaders: [] });

type DisabledServerState = Record<ContentKind, string[]>;

interface StoredContentState extends Partial<ProfileContentState> {
  disabledServerIds?: Partial<DisabledServerState>;
}

const emptyDisabledServerState = (): DisabledServerState => ({ mods: [], resourcePacks: [], shaders: [] });

function contentFileName(entry: LauncherProfile[ContentKind][number]): string | undefined {
  if (entry.fileName) return entry.fileName;
  try {
    const fileName = new URL(entry.url).pathname.split("/").filter(Boolean).pop();
    return fileName ? decodeURIComponent(fileName) : undefined;
  } catch {
    return undefined;
  }
}

function serverEntries(profile: LauncherProfile, kind: ContentKind, disabledServerIds: DisabledServerState): ManagedContentEntry[] {
  const disabled = new Set(disabledServerIds[kind]);
  return profile[kind].map((entry) => ({
    ...entry,
    source: "server",
    enabled: entry.required || !disabled.has(entry.id),
    fileName: contentFileName(entry),
  }));
}

function withoutDuplicateFiles(entries: ManagedContentEntry[]): ManagedContentEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!entry.fileName) return true;
    const key = entry.fileName.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadStoredState(profileId: string): { user: ProfileContentState; disabledServerIds: DisabledServerState } {
  try {
    const raw = localStorage.getItem(`${CONTENT_KEY_PREFIX}${profileId}`);
    if (!raw) return { user: emptyState(), disabledServerIds: emptyDisabledServerState() };
    const parsed = JSON.parse(raw) as StoredContentState;
    return {
      user: {
        mods: Array.isArray(parsed.mods) ? parsed.mods.filter((entry) => entry.source === "user") : [],
        resourcePacks: Array.isArray(parsed.resourcePacks) ? parsed.resourcePacks.filter((entry) => entry.source === "user") : [],
        shaders: Array.isArray(parsed.shaders) ? parsed.shaders.filter((entry) => entry.source === "user") : [],
      },
      disabledServerIds: {
        mods: Array.isArray(parsed.disabledServerIds?.mods) ? parsed.disabledServerIds.mods : [],
        resourcePacks: Array.isArray(parsed.disabledServerIds?.resourcePacks) ? parsed.disabledServerIds.resourcePacks : [],
        shaders: Array.isArray(parsed.disabledServerIds?.shaders) ? parsed.disabledServerIds.shaders : [],
      },
    };
  } catch {
    return { user: emptyState(), disabledServerIds: emptyDisabledServerState() };
  }
}

export function getProfileContent(profile: LauncherProfile): ProfileContentState {
  const { user, disabledServerIds } = loadStoredState(profile.id);
  return {
    mods: withoutDuplicateFiles([...serverEntries(profile, "mods", disabledServerIds), ...user.mods]),
    resourcePacks: withoutDuplicateFiles([...serverEntries(profile, "resourcePacks", disabledServerIds), ...user.resourcePacks]),
    shaders: withoutDuplicateFiles([...serverEntries(profile, "shaders", disabledServerIds), ...user.shaders]),
  };
}

export interface ProfileContentSyncItem {
  kind: ContentKind;
  fileName: string;
  enabled: boolean;
  url: string | null;
  sha512: string | null;
}

export interface ManagedProfileContentFile {
  profileId: string;
  kind: ContentKind;
  fileName: string;
  url: string | null;
}

export function getProfileContentSyncItems(profile: LauncherProfile): ProfileContentSyncItem[] {
  const state = getProfileContent(profile);
  return (Object.entries(state) as Array<[ContentKind, ManagedContentEntry[]]>).flatMap(([kind, entries]) =>
    entries
      .filter((entry) => Boolean(entry.fileName))
      .map((entry) => ({ kind, fileName: entry.fileName!, enabled: entry.enabled, url: entry.url || null, sha512: entry.sha512 || null })),
  );
}

export function getManagedProfileContentFiles(profiles: LauncherProfile[]): ManagedProfileContentFile[] {
  return profiles.flatMap((profile) =>
    getProfileContentSyncItems(profile).map((entry) => ({
      profileId: profile.id,
      kind: entry.kind,
      fileName: entry.fileName,
      url: entry.url,
    })),
  );
}

export function saveProfileContent(profileId: string, state: ProfileContentState): void {
  const userOnly: StoredContentState = {
    mods: state.mods.filter((entry) => entry.source === "user"),
    resourcePacks: state.resourcePacks.filter((entry) => entry.source === "user"),
    shaders: state.shaders.filter((entry) => entry.source === "user"),
    disabledServerIds: {
      mods: state.mods.filter((entry) => entry.source === "server" && !entry.required && !entry.enabled).map((entry) => entry.id),
      resourcePacks: state.resourcePacks.filter((entry) => entry.source === "server" && !entry.required && !entry.enabled).map((entry) => entry.id),
      shaders: state.shaders.filter((entry) => entry.source === "server" && !entry.required && !entry.enabled).map((entry) => entry.id),
    },
  };
  localStorage.setItem(`${CONTENT_KEY_PREFIX}${profileId}`, JSON.stringify(userOnly));
}

export function createUserContent(name: string, fileName?: string, projectId?: string, version = "local", iconUrl?: string, gameVersions?: string[], sha512?: string): ManagedContentEntry {
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
    iconUrl,
    gameVersions,
    sha512,
  };
}

export function validateProfileContent(profile: LauncherProfile): { valid: boolean; enabled: ManagedContentEntry[]; issues: string[] } {
  const state = getProfileContent(profile);
  const entries = [...state.mods, ...state.resourcePacks, ...state.shaders];
  const disabledRequired = entries
    .filter((entry) => entry.source === "server" && entry.required && !entry.enabled)
    .map((entry) => `필수 콘텐츠 비활성화: ${entry.name}`);
  const missingRequiredFiles = entries
    .filter((entry) => entry.source === "server" && entry.required && !entry.fileName)
    .map((entry) => `필수 콘텐츠 파일 정보 없음: ${entry.name}`);
  const issues = [...disabledRequired, ...missingRequiredFiles];
  return { valid: issues.length === 0, enabled: entries.filter((entry) => entry.enabled), issues };
}
