import { getCurrentWindow } from "@tauri-apps/api/window";
import { LauncherMenu } from "./LauncherMenu";
import type { LauncherSection } from "../types/navigation";
import type { LauncherProfile } from "../types/profile";

const isTauri = () => "__TAURI_INTERNALS__" in window;

interface WindowControlsProps {
  activeSection: LauncherSection;
  onNavigate: (section: LauncherSection) => void;
  profile?: LauncherProfile;
  updateAvailable?: boolean;
}

export function WindowActionButtons({ maximize = true, close = true }: { maximize?: boolean; close?: boolean }) {
  const minimizeWindow = () => { if (isTauri()) void getCurrentWindow().minimize(); };
  const closeWindow = () => { if (isTauri()) void getCurrentWindow().close(); };
  const toggleMaximize = () => { if (isTauri()) void getCurrentWindow().toggleMaximize(); };

  return <div className="window-actions">
    <button type="button" className="floating-control window-action minimize" onClick={minimizeWindow} aria-label="최소화"><span aria-hidden="true" /></button>
    {maximize && <button type="button" className="floating-control window-action maximize" onClick={toggleMaximize} aria-label="최대화 또는 이전 크기로 복원"><span aria-hidden="true" /></button>}
    {close && <button type="button" className="floating-control window-action close" onClick={closeWindow} aria-label="닫기"><span aria-hidden="true">×</span></button>}
  </div>;
}

export function WindowControls({ activeSection, onNavigate, profile, updateAvailable }: WindowControlsProps) {
  return <div className="window-titlebar" data-tauri-drag-region>
    <LauncherMenu activeSection={activeSection} onNavigate={onNavigate} profile={profile} updateAvailable={updateAvailable} />
    <WindowActionButtons />
  </div>;
}
