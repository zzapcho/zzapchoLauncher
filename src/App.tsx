import { LauncherShell } from "./components/LauncherShell";
import { useProfiles } from "./hooks/useProfiles";
import { AuthGate } from "./components/AuthGate";
import { UpdateOverlay } from "./components/UpdateOverlay";
import { useAppUpdate } from "./hooks/useAppUpdate";

export default function App() {
  const profiles = useProfiles();
  const appUpdate = useAppUpdate();
  if (appUpdate.updating) return <UpdateOverlay progress={appUpdate.progress} message={appUpdate.message} />;
  return <AuthGate>{(account, logout) => <LauncherShell {...profiles} account={account} onLogout={logout} appUpdate={appUpdate} />}</AuthGate>;
}
