import { invoke } from "@tauri-apps/api/core";
import type { LauncherAccount } from "../types/auth";

const ACCOUNT_KEY = "zzapchoLauncher.account";
const isTauri = () => "__TAURI_INTERNALS__" in window;

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
}

interface DeviceLoginSession extends DeviceCodeInfo {
  deviceCode: string;
  expiresIn: number;
  interval: number;
}

const saveAccount = (account: LauncherAccount) => localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: account.id, name: account.name, skinUrl: account.skinUrl, kind: account.kind, lastLoginAt: Date.now() }));

export function getStoredAccount(): LauncherAccount | null {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as LauncherAccount | null; }
  catch { return null; }
}

export async function loginWithMicrosoft(onCode: (info: DeviceCodeInfo) => void): Promise<LauncherAccount> {
  if (!isTauri()) throw new Error("Microsoft 로그인은 데스크톱 앱에서만 사용할 수 있습니다.");
  const device = await invoke<DeviceLoginSession>("begin_microsoft_device_login");
  onCode({ userCode: device.userCode, verificationUri: device.verificationUri });
  await invoke("open_external_url", { url: device.verificationUri });

  const deadline = Date.now() + device.expiresIn * 1000;
  const interval = Math.max(device.interval, 1) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, interval));
    const account = await invoke<LauncherAccount | null>("poll_microsoft_device_login", { deviceCode: device.deviceCode });
    if (account) { saveAccount(account); return account; }
  }
  throw new Error("Microsoft 로그인 시간이 만료됐습니다.");
}

export async function restoreAccount(): Promise<LauncherAccount | null> {
  const stored = getStoredAccount();
  if (stored?.kind === "preview") {
    localStorage.removeItem(ACCOUNT_KEY);
    return null;
  }
  if (!isTauri()) return stored;
  try {
    const account = await invoke<LauncherAccount | null>("restore_microsoft_account");
    if (account) {
      saveAccount(account);
      return account;
    }
  } catch (error) {
    console.warn("Microsoft 자동 로그인을 복구하지 못해 로컬 캐시를 먼저 표시합니다.", error);
  }
  return stored;
}

export async function logoutAccount(): Promise<void> {
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem("zzapchoLauncher.microsoftClientId");
  if (isTauri()) await invoke("delete_auth_secret");
}
