import { LauncherShell } from "./components/LauncherShell";
import { useProfiles } from "./hooks/useProfiles";
import { AuthGate } from "./components/AuthGate";
import { UpdateOverlay } from "./components/UpdateOverlay";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { ContextMenu } from "./components/ContextMenu";

export default function App() {
  const appUpdate = useAppUpdate();
  const profiles = useProfiles(appUpdate.checkNow);
  if (appUpdate.updating) return <><UpdateOverlay progress={appUpdate.progress} message={appUpdate.message} /><ContextMenu /></>;
  return <><AuthGate>{(account, logout) => <LauncherShell {...profiles} account={account} onLogout={logout} appUpdate={appUpdate} />}</AuthGate><ContextMenu /></>;
}
