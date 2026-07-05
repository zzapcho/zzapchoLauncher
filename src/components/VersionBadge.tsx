import type { LauncherProfile } from "../types/profile";

export function VersionBadge({ profile }: { profile: LauncherProfile }) {
  const loader = profile.modLoader.charAt(0).toUpperCase() + profile.modLoader.slice(1);
  return <div className="version-badge">Minecraft {profile.minecraftVersion}<span>·</span>{loader}</div>;
}
