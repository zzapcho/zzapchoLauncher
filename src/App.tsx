import { LauncherShell } from "./components/LauncherShell";
import { useProfiles } from "./hooks/useProfiles";
import { AuthGate } from "./components/AuthGate";

export default function App() {
  const profiles = useProfiles();
  return <AuthGate>{(account, logout) => <LauncherShell {...profiles} account={account} onLogout={logout} />}</AuthGate>;
}
