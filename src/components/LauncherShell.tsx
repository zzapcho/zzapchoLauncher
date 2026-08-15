import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAccentColor } from "../hooks/useAccentColor";
import { forceStopMinecraft, isMinecraftRunning, launchProfile, type LaunchProgress } from "../services/launchService";
import type { LauncherProfile } from "../types/profile";
import { PlayButton } from "./PlayButton";
import { ProfileSelector } from "./ProfileSelector";
import { VersionBadge } from "./VersionBadge";
import { WindowActionButtons, WindowControls } from "./WindowControls";
import { SectionPanel } from "./SectionPanel";
import type { LauncherSection } from "../types/navigation";
import type { LauncherAccount } from "../types/auth";
import type { AppUpdateState } from "../hooks/useAppUpdate";
import { applyProfileConfiguration, useProfileConfiguration } from "../hooks/useProfileConfiguration";

interface LauncherShellProps {
  profiles: LauncherProfile[];
  selectedProfile?: LauncherProfile;
  selectProfile: (id: string) => void;
  refreshProfiles: (force?: boolean) => Promise<LauncherProfile[]>;
  loading: boolean;
  account: LauncherAccount;
  onLogout: () => Promise<void>;
  appUpdate: AppUpdateState;
}

export function LauncherShell({ profiles, selectedProfile, selectProfile, refreshProfiles, loading, account, onLogout, appUpdate }: LauncherShellProps) {
  const configuration = useProfileConfiguration(selectedProfile);
  const profile = configuration.profile;
  const accent = useAccentColor(profile);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress>({ status: "idle", message: "플레이", progress: 100 });
  const [toast, setToast] = useState<string | null>(null);
  const [toastClosing, setToastClosing] = useState(false);
  const [activeSection, setActiveSection] = useState<LauncherSection>("home");
  const [switchingProfile, setSwitchingProfile] = useState(false);
  const [wideLayout, setWideLayout] = useState(() => window.innerWidth >= 780);
  const transitionTimers = useRef<number[]>([]);
  const status = launchProgress.status;
  const busy = !["idle", "error"].includes(status);

  useEffect(() => () => transitionTimers.current.forEach(window.clearTimeout), []);
  useEffect(() => {
    if (!toast) return;
    setToastClosing(false);
    const closeTimer = window.setTimeout(() => setToastClosing(true), 2_600);
    const removeTimer = window.setTimeout(() => setToast(null), 2_800);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast]);
  useEffect(() => {
    let frame = 0;
    const updateLayout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWideLayout((current) => current ? window.innerWidth >= 730 : window.innerWidth >= 790));
    };
    window.addEventListener("resize", updateLayout);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", updateLayout); };
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void isMinecraftRunning().then((running) => {
      if (running) setLaunchProgress({ status: "running", message: "Minecraft 실행 중", progress: 100 });
    }).catch(() => undefined);
    const unlisten = listen<{ code: number | null; forced?: boolean }>("game-exited", (event) => {
      setLaunchProgress({ status: "idle", message: "플레이", progress: 100 });
      if (!event.payload.forced && event.payload.code !== 0) {
        setToast(`Minecraft가 비정상 종료되었습니다${event.payload.code === null ? "." : ` (코드 ${event.payload.code}).`}`);
      }
    });
    return () => { void unlisten.then((dispose) => dispose()); };
  }, []);
  useEffect(() => {
    const returnHome = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeSection !== "home") setActiveSection("home");
    };
    document.addEventListener("keydown", returnHome);
    return () => document.removeEventListener("keydown", returnHome);
  }, [activeSection]);
  useEffect(() => {
    if (profile?.modLoader !== "vanilla" || !["mods", "shaders"].includes(activeSection)) return;
    setActiveSection("home");
  }, [profile?.modLoader, activeSection]);

  if (loading) return <main className="empty-state"><span className="loader" />프로필을 불러오는 중...</main>;
  if (!profile) return <main className="empty-state empty-profile-state">
    <div className="window-titlebar empty-state-titlebar" data-tauri-drag-region>
      <WindowActionButtons maximize={false} />
    </div>
    사용 가능한 프로필이 없어요.
  </main>;

  const handleLaunch = async () => {
    try {
      setLaunchProgress({ status: "checking-profile", message: "프로필 확인 중", progress: 3 });
      const latestProfiles = await refreshProfiles(true);
      const latestBase = latestProfiles.find((item) => item.id === profile.id) ?? latestProfiles[0];
      if (!latestBase) throw new Error("사용 가능한 프로필이 없습니다.");
      const result = await launchProfile(applyProfileConfiguration(latestBase), account, setLaunchProgress);
      setLaunchProgress({ status: "running", message: "Minecraft 실행 중", progress: 100 });
      console.info(result.message);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "게임 실행에 실패했습니다.";
      setLaunchProgress({ status: "error", message: "다시 시도", progress: 100 });
      setToast(message);
    }
  };

  const handleStop = async () => {
    try {
      setLaunchProgress({ status: "preparing", message: "게임 종료 중", progress: 100 });
      await forceStopMinecraft();
    } catch (error) {
      setLaunchProgress({ status: "running", message: "Minecraft 실행 중", progress: 100 });
      setToast(error instanceof Error ? error.message : "게임을 종료하지 못했습니다.");
    }
  };

  const background = `url("${profile.backgroundImage}")`;

  const navigate = (section: LauncherSection) => {
    if (profile.modLoader === "vanilla" && (section === "mods" || section === "shaders")) {
      setToast(`바닐라 입니다\n${section === "mods" ? "모드" : "쉐이더"}를 선택할 수 없습니다`);
      return;
    }
    void refreshProfiles();
    setActiveSection(section);
  };

  const changeProfile = (id: string) => {
    if (id === profile.id) return;
    transitionTimers.current.forEach(window.clearTimeout);
    setSwitchingProfile(true);
    transitionTimers.current = [
      window.setTimeout(() => { selectProfile(id); if (status !== "running") setLaunchProgress({ status: "idle", message: "플레이", progress: 100 }); }, 140),
      window.setTimeout(() => setSwitchingProfile(false), 300),
    ];
  };

  return (
    <main className={`launcher-shell${switchingProfile ? " is-profile-switching" : ""}${wideLayout ? " is-wide" : ""}${activeSection === "home" ? " is-home" : ""}`} style={{ "--accent": accent, "--background": background } as React.CSSProperties}>
      <div className="edge-distortion" aria-hidden="true" />
      <WindowControls activeSection={activeSection} onNavigate={navigate} profile={profile} updateAvailable={appUpdate.available} />

      {activeSection === "home" ? <section className="hero" aria-label={`${profile.name} 실행`}>
        <div className="profile-copy">
          <h2>{profile.customText}</h2>
        </div>
        <PlayButton status={status} message={launchProgress.message} progress={launchProgress.progress} onLaunch={handleLaunch} onStop={handleStop} />
        <VersionBadge profile={profile} configuration={configuration} />
      </section> : <SectionPanel profile={profile} configuration={configuration} section={activeSection} account={account} onLogout={onLogout} appUpdate={appUpdate} />}

      {activeSection === "home" && <ProfileSelector profiles={profiles} selectedProfile={profile} onSelect={changeProfile} disabled={busy} />}
      {toast && <div className={`launcher-toast${toastClosing ? " is-closing" : ""}`} role="alert">
        <button className="toast-message" type="button" title={toast} onClick={() => { setToast(null); navigate("logs"); }}>{toast}</button>
        <button className="toast-close" type="button" aria-label="알림 닫기" onClick={() => { setToastClosing(true); window.setTimeout(() => setToast(null), 180); }}>×</button>
      </div>}
    </main>
  );
}
