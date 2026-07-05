import { getCurrentWindow } from "@tauri-apps/api/window";
import { LauncherMenu } from "./LauncherMenu";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export function WindowControls() {
  const minimize = () => {
    if (isTauri()) void getCurrentWindow().minimize();
  };

  const close = () => {
    if (isTauri()) void getCurrentWindow().close();
  };

  return (
    <div className="window-titlebar" data-tauri-drag-region>
      <LauncherMenu />
      <div className="window-actions">
        <button type="button" className="floating-control window-action minimize" onClick={minimize} aria-label="최소화">
          <span aria-hidden="true" />
        </button>
        <button type="button" className="floating-control window-action close" onClick={close} aria-label="닫기">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
