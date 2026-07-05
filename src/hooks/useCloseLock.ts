import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useCloseLock(locked: boolean) {
  useEffect(() => {
    if (!locked || !("__TAURI_INTERNALS__" in window)) return;
    const unlisten = getCurrentWindow().onCloseRequested((event) => event.preventDefault());
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [locked]);
}
