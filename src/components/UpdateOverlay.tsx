import { WindowActionButtons } from "./WindowControls";
import { useCloseLock } from "../hooks/useCloseLock";

export function UpdateOverlay({ progress, message }: { progress: number; message: string }) {
  useCloseLock(true);
  return <main className="update-screen">
    <div className="window-titlebar login-titlebar" data-tauri-drag-region>
      <WindowActionButtons maximize={false} />
    </div>
    <div className="update-status">
      <span className="loader" />
      <h1>업데이트 중</h1>
      <p>{message}</p>
      <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>{progress}%</small>
    </div>
  </main>;
}
