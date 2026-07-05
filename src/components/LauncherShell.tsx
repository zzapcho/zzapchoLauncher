import { useEffect, useRef, useState } from "react";
import { useAccentColor } from "../hooks/useAccentColor";
import { launchProfile } from "../services/launchService";
import type { LauncherProfile, LaunchStatus } from "../types/profile";
import { PlayButton } from "./PlayButton";
import { ProfileSelector } from "./ProfileSelector";
import { VersionBadge } from "./VersionBadge";
import { WindowControls } from "./WindowControls";
import { SectionPanel } from "./SectionPanel";
import type { LauncherSection } from "../types/navigation";
import type { LauncherAccount } from "../types/auth";

interface LauncherShellProps {
  profiles: LauncherProfile[];
  selectedProfile?: LauncherProfile;
  selectProfile: (id: string) => void;
  loading: boolean;
  account: LauncherAccount;
  onLogout: () => Promise<void>;
}

export function LauncherShell({ profiles, selectedProfile, selectProfile, loading, account, onLogout }: LauncherShellProps) {
  const accent = useAccentColor(selectedProfile);
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [activeSection, setActiveSection] = useState<LauncherSection>("home");
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const transitionTimers = useRef<number[]>([]);
  const busy = !["idle", "stub", "error"].includes(status);

  useEffect(() => () => transitionTimers.current.forEach(window.clearTimeout), []);
  useEffect(() => {
    const returnHome = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeSection !== "home") setActiveSection("home");
    };
    document.addEventListener("keydown", returnHome);
    return () => document.removeEventListener("keydown", returnHome);
  }, [activeSection]);

  if (loading) return <main className="empty-state"><span className="loader" />프로필을 불러오는 중...</main>;
  if (!selectedProfile) return <main className="empty-state">사용 가능한 프로필이 없어요.</main>;

  const handleLaunch = async () => {
    try {
      const result = await launchProfile(selectedProfile, (progress) => {
        setStatus(progress.status);
      });
      setStatus("stub");
      console.info(result.message);
    } catch (error) {
      console.error(error);
      setStatus("error");
    }
  };

  const background = `url("${selectedProfile.backgroundImage}")`;

  const changeProfile = (id: string) => {
    if (id === selectedProfile.id) return;
    transitionTimers.current.forEach(window.clearTimeout);
    setSwitchingProfile(true);
    transitionTimers.current = [
      window.setTimeout(() => { selectProfile(id); setStatus("idle"); }, 140),
      window.setTimeout(() => setSwitchingProfile(false), 300),
    ];
  };

  return (
    <main className={`launcher-shell${switchingProfile ? " is-profile-switching" : ""}`} style={{ "--accent": accent, "--background": background } as React.CSSProperties}>
      <div className="edge-distortion" aria-hidden="true" />
      <WindowControls activeSection={activeSection} onNavigate={setActiveSection} />

      {activeSection === "home" ? <section className="hero" aria-label={`${selectedProfile.name} 실행`}>
        <div className="profile-copy">
          <h2>{selectedProfile.customText}</h2>
        </div>
        <PlayButton busy={busy} onClick={handleLaunch} />
        <VersionBadge profile={selectedProfile} />
      </section> : <SectionPanel profile={selectedProfile} section={activeSection} account={account} onLogout={onLogout} />}

      {activeSection === "home" && <ProfileSelector profiles={profiles} selectedProfile={selectedProfile} onSelect={changeProfile} disabled={busy} />}
    </main>
  );
}
