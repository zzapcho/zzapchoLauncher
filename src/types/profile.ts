export type ModLoader = "fabric" | "forge" | "quilt" | "vanilla";

export interface ContentEntry {
  id: string;
  name: string;
  version: string;
  required: boolean;
  url: string;
}

export interface EditableFields {
  mods: boolean;
  resourcePacks: boolean;
  shaders: boolean;
  minecraftVersion: boolean;
  modLoader: boolean;
  javaArgs: boolean;
  memory: boolean;
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
  javaVersion?: number;
  mods: ContentEntry[];
  resourcePacks: ContentEntry[];
  shaders: ContentEntry[];
  editableFields: EditableFields;
  launchOptions: {
    minMemoryMb: number;
    maxMemoryMb: number;
    javaArgs: string[];
  };
}

export type LaunchStatus = "idle" | "preparing" | "checking-profile" | "checking-content" | "ready" | "running" | "error";

export interface LaunchResult {
  success: boolean;
  message: string;
  profileId: string;
}
