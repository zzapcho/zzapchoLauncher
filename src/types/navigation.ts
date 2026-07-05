export type LauncherSection = "home" | "mods" | "resource-packs" | "shaders" | "logs" | "settings";

export interface LauncherNavItem {
  id: LauncherSection;
  label: string;
}

export const LAUNCHER_NAV_ITEMS: LauncherNavItem[] = [
  { id: "home", label: "홈" },
  { id: "mods", label: "모드" },
  { id: "resource-packs", label: "리소스팩" },
  { id: "shaders", label: "쉐이더" },
  { id: "logs", label: "로그" },
  { id: "settings", label: "설정" },
];
