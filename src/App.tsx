import { useEffect } from "react";
import { LauncherShell } from "./components/LauncherShell";
import { useProfiles } from "./hooks/useProfiles";
import { AuthGate } from "./components/AuthGate";
import { UpdateOverlay } from "./components/UpdateOverlay";
import { useAppUpdate } from "./hooks/useAppUpdate";

export default function App() {
  const appUpdate = useAppUpdate();
  const profiles = useProfiles(appUpdate.checkNow);
  useEffect(() => {
    const restrictContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], .log-view, .device-code")) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", restrictContextMenu);
    return () => document.removeEventListener("contextmenu", restrictContextMenu);
  }, []);
  if (appUpdate.updating) return <UpdateOverlay progress={appUpdate.progress} message={appUpdate.message} />;
  return <AuthGate>{(account, logout) => <LauncherShell {...profiles} account={account} onLogout={logout} appUpdate={appUpdate} />}</AuthGate>;
}
