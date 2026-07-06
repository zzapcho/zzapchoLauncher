import { useMemo, useState } from "react";
import type { LauncherProfile, ModLoader } from "../types/profile";
import { recommendedJavaMajor } from "../services/javaService";

interface ProfileOverrides {
  minecraftVersion?: string;
  modLoader?: ModLoader;
  modLoaderVersion?: string;
}

export interface ProfileConfiguration {
  profile?: LauncherProfile;
  setMinecraftVersion: (version: string) => void;
  setModLoader: (loader: ModLoader) => void;
  setModLoaderVersion: (version: string) => void;
}

const keyFor = (profileId: string) => `zzapchoLauncher.profileConfiguration.${profileId}`;

function load(profileId: string): ProfileOverrides {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(profileId)) ?? "null") as ProfileOverrides | null;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function applyProfileConfiguration(base: LauncherProfile): LauncherProfile {
  const overrides = load(base.id);
  const minecraftVersion = base.editableFields.minecraftVersion && overrides.minecraftVersion ? overrides.minecraftVersion : base.minecraftVersion;
  return {
    ...base,
    minecraftVersion,
    javaVersion: base.editableFields.minecraftVersion && overrides.minecraftVersion ? recommendedJavaMajor(minecraftVersion) : base.javaVersion,
    modLoader: base.editableFields.modLoader ? (overrides.modLoader ?? base.modLoader) : base.modLoader,
    modLoaderVersion: base.editableFields.modLoader ? (overrides.modLoaderVersion ?? (overrides.modLoader ? "" : base.modLoaderVersion)) : base.modLoaderVersion,
  };
}

export function useProfileConfiguration(base?: LauncherProfile): ProfileConfiguration {
  const [revision, setRevision] = useState(0);
  const profile = useMemo(() => base ? applyProfileConfiguration(base) : undefined, [base, revision]);

  const save = (patch: Partial<ProfileOverrides>) => {
    if (!base) return;
    localStorage.setItem(keyFor(base.id), JSON.stringify({ ...load(base.id), ...patch }));
    setRevision((value) => value + 1);
  };

  return {
    profile,
    setMinecraftVersion: (minecraftVersion) => {
      if (base?.editableFields.minecraftVersion && minecraftVersion.trim()) save({ minecraftVersion: minecraftVersion.trim(), modLoaderVersion: "" });
    },
    setModLoader: (modLoader) => {
      if (base?.editableFields.modLoader) save({ modLoader, modLoaderVersion: "" });
    },
    setModLoaderVersion: (modLoaderVersion) => {
      if (base?.editableFields.modLoader) save({ modLoaderVersion: modLoaderVersion.trim() });
    },
  };
}
