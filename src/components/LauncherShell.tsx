import { useState } from "react";
import { useAccentColor } from "../hooks/useAccentColor";
import { launchProfile } from "../services/launchService";
import type { LauncherProfile, LaunchStatus } from "../types/profile";
import { PlayButton } from "./PlayButton";
import { ProfileSelector } from "./ProfileSelector";
import { VersionBadge } from "./VersionBadge";
import { WindowControls } from "./WindowControls";

interface LauncherShellProps {
  profiles: LauncherProfile[];
  selectedProfile?: LauncherProfile;
  selectProfile: (id: string) => void;
  loading: boolean;
}

export function LauncherShell({ profiles, selectedProfile, selectProfile, loading }: LauncherShellProps) {
  const accent = useAccentColor(selectedProfile);
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const busy = !["idle", "stub", "error"].includes(status);

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

  return (
    <main className="launcher-shell" style={{ "--accent": accent, "--background": background } as React.CSSProperties}>
      <div className="edge-distortion" aria-hidden="true" />
      <WindowControls />

      <section className="hero" aria-label={`${selectedProfile.name} 실행`}>
        <div className="profile-copy">
          <p className="eyebrow">{selectedProfile.name}</p>
          <h2>{selectedProfile.customText}</h2>
        </div>
        <PlayButton busy={busy} onClick={handleLaunch} />
        <VersionBadge profile={selectedProfile} />
      </section>

      <ProfileSelector profiles={profiles} selectedProfile={selectedProfile} onSelect={(id) => { selectProfile(id); setStatus("idle"); }} disabled={busy} />
    </main>
  );
}
