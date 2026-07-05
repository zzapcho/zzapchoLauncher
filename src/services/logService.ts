import { listen } from "@tauri-apps/api/event";

export type LogSource = "game" | "launcher";

const logs: Record<LogSource, string[]> = {
  game: [],
  launcher: [`[${new Date().toLocaleTimeString("ko-KR")}] 런처 시작`],
};
const listeners = new Set<() => void>();
let bridgeStarted = false;

const emit = () => listeners.forEach((listener) => listener());

export function getLogs(source: LogSource): string[] {
  return logs[source];
}

export function subscribeLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function appendLog(source: LogSource, message: string): void {
  const time = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  logs[source] = [...logs[source], `[${time}] ${message}`].slice(-500);
  emit();
}

export function appendRawGameLog(message: string): void {
  logs.game = [...logs.game, message].slice(-2000);
  emit();
}

export function initializeLogBridge(): void {
  if (bridgeStarted || !("__TAURI_INTERNALS__" in window)) return;
  bridgeStarted = true;
  void listen<string>("game-log", (event) => appendRawGameLog(event.payload));
  void listen<string>("launcher-log", (event) => appendLog("launcher", event.payload));
  void listen<{ code: number | null }>("game-exited", (event) => {
    appendLog("launcher", `Minecraft 종료${event.payload.code === null ? "" : ` (코드 ${event.payload.code})`}`);
  });
}

export function resetGameLogs(): void {
  logs.game = [];
  emit();
}
