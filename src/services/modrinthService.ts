import type { ContentKind } from "../types/content";
import type { LauncherProfile } from "../types/profile";

const MODRINTH_API = "https://api.modrinth.com/v2";

export interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  author: string;
  project_type: "mod" | "resourcepack" | "shader";
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  files: Array<{ url: string; filename: string; primary: boolean }>;
}

const projectType: Record<ContentKind, ModrinthProject["project_type"]> = {
  mods: "mod",
  resourcePacks: "resourcepack",
  shaders: "shader",
};

export interface ModrinthSearchResult {
  hits: ModrinthProject[];
  total: number;
}

export async function searchModrinth(kind: ContentKind, profile: LauncherProfile, query = "", offset = 0, limit = 6): Promise<ModrinthSearchResult> {
  const facets = [[`project_type:${projectType[kind]}`], [`versions:${profile.minecraftVersion}`]];
  if (kind === "mods" && profile.modLoader !== "vanilla") facets.push([`categories:${profile.modLoader}`]);
  const params = new URLSearchParams({ query, index: query ? "relevance" : "downloads", limit: String(limit), offset: String(offset), facets: JSON.stringify(facets) });
  const response = await fetch(`${MODRINTH_API}/search?${params}`);
  if (!response.ok) throw new Error(`Modrinth search failed: ${response.status}`);
  const payload = await response.json() as { hits: ModrinthProject[]; total_hits: number };
  return { hits: payload.hits, total: payload.total_hits };
}

export async function getInstallableVersion(projectId: string, kind: ContentKind, profile: LauncherProfile): Promise<{ version: string; url: string; fileName: string }> {
  const params = new URLSearchParams({ game_versions: JSON.stringify([profile.minecraftVersion]) });
  if (kind === "mods" && profile.modLoader !== "vanilla") params.set("loaders", JSON.stringify([profile.modLoader]));
  const response = await fetch(`${MODRINTH_API}/project/${projectId}/version?${params}`);
  if (!response.ok) throw new Error(`Modrinth versions failed: ${response.status}`);
  const versions = await response.json() as ModrinthVersion[];
  const latest = versions[0];
  const file = latest?.files.find((item) => item.primary) ?? latest?.files[0];
  if (!latest || !file) throw new Error("호환되는 파일이 없습니다.");
  return { version: latest.version_number, url: file.url, fileName: file.filename };
}
