import { LauncherShell } from "./components/LauncherShell";
import { useProfiles } from "./hooks/useProfiles";

export default function App() {
  const profiles = useProfiles();
  return <LauncherShell {...profiles} />;
}
