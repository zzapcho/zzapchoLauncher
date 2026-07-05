import { useState } from "react";
import { useAccentColor } from "../hooks/useAccentColor";
import { launchProfile } from "../services/launchService";
import type { LauncherProfile, LaunchStatus } from "../types/profile";
import { PlayButton } from "./PlayButton";
import { ProfileSelector } from "./ProfileSelector";
import { StatusText } from "./StatusText";
import { VersionBadge } from "./VersionBadge";

interface LauncherShellProps {
  profiles: LauncherProfile[];
  selectedProfile?: LauncherProfile;
  selectProfile: (id: string) => void;
  loading: boolean;
}

export function LauncherShell({ profiles, selectedProfile, selectProfile, loading }: LauncherShellProps) {
  const accent = useAccentColor(selectedProfile);
  const [status, setStatus] = useState<LaunchStatus>("idle");
  const [message, setMessage] = useState("플레이할 준비가 됐어요");
  const busy = !["idle", "stub", "error"].includes(status);

  if (loading) return <main className="empty-state"><span className="loader" />프로필을 불러오는 중...</main>;
  if (!selectedProfile) return <main className="empty-state">사용 가능한 프로필이 없어요.</main>;

  const handleLaunch = async () => {
    try {
      const result = await launchProfile(selectedProfile, (progress) => {
        setStatus(progress.status);
        setMessage(progress.message);
      });
      setStatus("stub");
      setMessage(result.message);
    } catch (error) {
      console.error(error);
      setStatus("error");
      setMessage("실행 준비 중 문제가 생겼어요.");
    }
  };

  const background = `linear-gradient(180deg, rgba(4, 8, 6, .15), rgba(3, 6, 5, .82)), url("${selectedProfile.backgroundImage}")`;

  return (
    <main className="launcher-shell" style={{ "--accent": accent, "--background": background } as React.CSSProperties}>
      <div className="ambient-light" />
      <header className="launcher-header">
        <div className="brand-mark"><span>z</span></div>
        <div><p>ZZAPCHO</p><h1>Launcher</h1></div>
        <div className="online-chip"><span /> ONLINE</div>
      </header>

      <section className="hero" aria-label={`${selectedProfile.name} 실행`}>
        <div className="profile-copy">
          <p className="eyebrow">{selectedProfile.name}</p>
          <h2>{selectedProfile.customText}</h2>
          <p className="description">{selectedProfile.description}</p>
        </div>
        <PlayButton busy={busy} onClick={handleLaunch} />
        <VersionBadge profile={selectedProfile} />
        <StatusText message={message} busy={busy} />
      </section>

      <ProfileSelector profiles={profiles} selectedProfile={selectedProfile} onSelect={(id) => { selectProfile(id); setStatus("idle"); setMessage("플레이할 준비가 됐어요"); }} disabled={busy} />
    </main>
  );
}
