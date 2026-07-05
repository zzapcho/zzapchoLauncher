export type ModLoader = "fabric" | "forge" | "quilt" | "vanilla";

export interface LauncherAsset {
  id: string;
  name: string;
  version: string;
  required: boolean;
  url: string;
  sha256?: string;
}

export interface DefaultServer {
  name: string;
  address: string;
  port: number;
}

export interface EditableFields {
  server: boolean;
  mods: boolean;
  resourcePacks: boolean;
  shaders: boolean;
  minecraftVersion: boolean;
  modLoader: boolean;
  javaArgs: boolean;
  memory: boolean;
}

export interface LaunchOptions {
  minMemoryMb: number;
  maxMemoryMb: number;
  javaArgs: string[];
}

export interface LauncherProfile {
  id: string;
  name: string;
  description: string;
  customText: string;
  backgroundImage: string;
  accentColor: string;
  minecraftVersion: string;
  modLoader: ModLoader;
  modLoaderVersion: string;
  defaultServer: DefaultServer;
  mods: LauncherAsset[];
  resourcePacks: LauncherAsset[];
  shaders: LauncherAsset[];
  editableFields: EditableFields;
  launchOptions: LaunchOptions;
}

export type ProfilesManifest = LauncherProfile[];

export const MOD_LOADERS: ModLoader[] = ["vanilla", "fabric", "forge", "quilt"];

export const EMPTY_EDITABLE_FIELDS: EditableFields = {
  server: false,
  mods: false,
  resourcePacks: true,
  shaders: true,
  minecraftVersion: false,
  modLoader: false,
  javaArgs: true,
  memory: true,
};
