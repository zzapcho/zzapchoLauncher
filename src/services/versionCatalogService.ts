import type { ModLoader } from "../types/profile";
import { invoke } from "@tauri-apps/api/core";

interface MinecraftManifest {
  versions?: Array<{ id?: string; type?: string }>;
}

const MINECRAFT_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function getMinecraftVersions(): Promise<string[]> {
  if (isTauri()) return invoke<string[]>("minecraft_versions");
  const response = await fetch(MINECRAFT_MANIFEST, { cache: "no-store" });
  if (!response.ok) throw new Error(`Minecraft 버전 조회 실패: ${response.status}`);
  const manifest = await response.json() as MinecraftManifest;
  return (manifest.versions ?? [])
    .filter((version) => version.type === "release" && version.id)
    .map((version) => version.id!)
    .slice(0, 80);
}

export async function getLoaderVersions(loader: ModLoader, minecraftVersion: string): Promise<string[]> {
  if (loader === "vanilla") return [];
  if (isTauri()) return invoke<string[]>("loader_versions", { loader, minecraftVersion });
  if (loader === "fabric") {
    const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Fabric 버전 조회 실패: ${response.status}`);
    const values = await response.json() as Array<{ loader?: { version?: string; stable?: boolean } }>;
    return values.map((value) => value.loader?.version).filter((value): value is string => Boolean(value));
  }
  if (loader === "quilt") {
    const response = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Quilt 버전 조회 실패: ${response.status}`);
    const values = await response.json() as Array<{ loader?: { version?: string } }>;
    return values.map((value) => value.loader?.version).filter((value): value is string => Boolean(value));
  }
  const response = await fetch("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Forge 버전 조회 실패: ${response.status}`);
  const data = await response.json() as { promos?: Record<string, string> };
  return [...new Set([data.promos?.[`${minecraftVersion}-latest`], data.promos?.[`${minecraftVersion}-recommended`]].filter((value): value is string => Boolean(value)))];
}
