export type LogSource = "game" | "launcher";

const logs: Record<LogSource, string[]> = {
  game: [],
  launcher: [`[${new Date().toLocaleTimeString("ko-KR")}] 런처 시작`],
};
const listeners = new Set<() => void>();

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

export function resetGameLogs(): void {
  logs.game = [];
  emit();
}
