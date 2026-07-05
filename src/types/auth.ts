export interface LauncherAccount {
  id: string;
  name: string;
  skinUrl?: string;
  kind: "microsoft" | "preview";
  minecraftAccessToken?: string;
}
