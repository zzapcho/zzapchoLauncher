import type { LaunchStatus } from "../types/profile";

interface PlayButtonProps {
  status: LaunchStatus;
  message: string;
  progress: number;
  onLaunch: () => void;
  onStop: () => void;
}

export function PlayButton({ status, message, progress, onLaunch, onStop }: PlayButtonProps) {
  const running = status === "running";
  const busy = !["idle", "error", "running"].includes(status);
  const label = running ? "강제 종료" : status === "idle" ? "플레이" : status === "error" ? "다시 시도" : message;
  const width = Math.min(230, Math.max(140, 92 + label.length * 10));
  return (
    <button
      className={`play-button${running ? " is-force-stop" : ""}${busy ? " is-progressing" : ""}`}
      type="button"
      onClick={running ? onStop : onLaunch}
      disabled={busy}
      aria-label={running ? "Minecraft 강제 종료" : "선택한 프로필 실행"}
      style={{ "--play-progress": `${Math.max(0, Math.min(100, progress))}%`, "--play-width": `${width}px` } as React.CSSProperties}
    >
      <span>{label}</span>
    </button>
  );
}
