import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface AvailableUpdate {
  version: string;
  notes?: string;
}

export interface UpdateProgress {
  percent: number;
  message: string;
}

let pendingUpdate: Update | null = null;
const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  pendingUpdate = await check({ timeout: 15_000 });
  if (!pendingUpdate) return null;
  return { version: pendingUpdate.version, notes: pendingUpdate.body ?? undefined };
}

export async function installUpdate(onProgress: (progress: UpdateProgress) => void): Promise<void> {
  const update = pendingUpdate ?? await check({ timeout: 15_000 });
  if (!update) throw new Error("설치할 업데이트가 없습니다.");

  let downloaded = 0;
  let total = 0;
  const report = (event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress({ percent: 3, message: "업데이트를 내려받는 중..." });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      const percent = total > 0 ? Math.min(92, Math.round((downloaded / total) * 90) + 3) : 45;
      onProgress({ percent, message: "업데이트를 내려받는 중..." });
    } else if (event.event === "Finished") {
      onProgress({ percent: 96, message: "업데이트를 설치하는 중..." });
    }
  };

  await update.downloadAndInstall(report);
  onProgress({ percent: 100, message: "업데이트를 적용하고 다시 시작합니다..." });
  await relaunch();
}
