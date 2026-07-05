import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, installUpdate } from "../services/updateService";

export interface AppUpdateState {
  available: boolean;
  version?: string;
  notes?: string;
  checking: boolean;
  updating: boolean;
  progress: number;
  message: string;
  error: string;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
}

export function useAppUpdate(): AppUpdateState {
  const [version, setVersion] = useState<string>();
  const [notes, setNotes] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("업데이트를 준비하는 중...");
  const [error, setError] = useState("");

  const checkNow = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const update = await checkForUpdate();
      setVersion(update?.version);
      setNotes(update?.notes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "업데이트 확인에 실패했습니다.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkNow(), 1_500);
    return () => window.clearTimeout(timer);
  }, [checkNow]);

  const install = useCallback(async () => {
    setUpdating(true);
    setError("");
    setProgress(0);
    try {
      await installUpdate((next) => {
        setProgress(next.percent);
        setMessage(next.message);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "업데이트 설치에 실패했습니다.");
      setUpdating(false);
    }
  }, []);

  return { available: Boolean(version), version, notes, checking, updating, progress, message, error, checkNow, install };
}
