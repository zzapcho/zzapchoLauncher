import { getCurrentWindow } from "@tauri-apps/api/window";
import { LauncherMenu } from "./LauncherMenu";
import type { LauncherSection } from "../types/navigation";

const isTauri = () => "__TAURI_INTERNALS__" in window;

interface WindowControlsProps {
  activeSection: LauncherSection;
  onNavigate: (section: LauncherSection) => void;
}

export function WindowActionButtons({ maximize = true }: { maximize?: boolean }) {
  const minimize = () => {
    if (isTauri()) void getCurrentWindow().minimize();
  };

  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };

  const toggleMaximize = () => {
    if (isTauri()) void getCurrentWindow().toggleMaximize();
  };

  return <div className="window-actions">
        <button type="button" className="floating-control window-action minimize" onClick={minimize} aria-label="최소화">
          <span aria-hidden="true" />
        </button>
        {maximize && <button type="button" className="floating-control window-action maximize" onClick={toggleMaximize} aria-label="최대화 또는 이전 크기로 복원">
          <span aria-hidden="true" />
        </button>}
        <button type="button" className="floating-control window-action close" onClick={close} aria-label="닫기">
          <span aria-hidden="true">×</span>
        </button>
      </div>;
}

export function WindowControls({ activeSection, onNavigate }: WindowControlsProps) {
  return (
    <div className="window-titlebar" data-tauri-drag-region>
      <LauncherMenu activeSection={activeSection} onNavigate={onNavigate} />
      <WindowActionButtons />
    </div>
  );
}
