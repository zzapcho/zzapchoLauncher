import { invoke } from "@tauri-apps/api/core";
import type { LauncherAccount } from "../types/auth";

const CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID?.trim() ?? "";
const ACCOUNT_KEY = "zzapchoLauncher.account";
const SCOPE = "XboxLive.signin offline_access";
const isTauri = () => "__TAURI_INTERNALS__" in window;

interface MicrosoftToken {
  access_token: string;
  refresh_token: string;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  message: string;
}

export const hasMicrosoftClientId = Boolean(CLIENT_ID);

const saveAccount = (account: LauncherAccount) => localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ id: account.id, name: account.name, skinUrl: account.skinUrl, kind: account.kind }));

export function getStoredAccount(): LauncherAccount | null {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as LauncherAccount | null; }
  catch { return null; }
}

async function tokenRequest(params: URLSearchParams): Promise<MicrosoftToken> {
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params,
  });
  const payload = await response.json() as MicrosoftToken & { error?: string; error_description?: string };
  if (!response.ok) throw new Error(payload.error_description ?? payload.error ?? "Microsoft token request failed");
  return payload;
}

async function exchangeForMinecraft(token: MicrosoftToken): Promise<LauncherAccount> {
  const xboxResponse = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${token.access_token}` }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" }),
  });
  if (!xboxResponse.ok) throw new Error("Xbox Live 인증에 실패했습니다.");
  const xbox = await xboxResponse.json() as { Token: string; DisplayClaims: { xui: Array<{ uhs: string }> } };
  const userHash = xbox.DisplayClaims.xui[0]?.uhs;

  const xstsResponse = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Properties: { SandboxId: "RETAIL", UserTokens: [xbox.Token] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" }),
  });
  if (!xstsResponse.ok) throw new Error("Xbox 계정 권한을 확인하지 못했습니다.");
  const xsts = await xstsResponse.json() as { Token: string };

  const minecraftResponse = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xsts.Token}` }),
  });
  if (!minecraftResponse.ok) throw new Error("Minecraft 서비스 로그인에 실패했습니다.");
  const minecraft = await minecraftResponse.json() as { access_token: string };

  const profileResponse = await fetch("https://api.minecraftservices.com/minecraft/profile", { headers: { Authorization: `Bearer ${minecraft.access_token}` } });
  if (!profileResponse.ok) throw new Error("Minecraft Java Edition 프로필을 찾지 못했습니다.");
  const profile = await profileResponse.json() as { id: string; name: string; skins?: Array<{ url: string }> };
  const account: LauncherAccount = { id: profile.id, name: profile.name, skinUrl: profile.skins?.[0]?.url, kind: "microsoft", minecraftAccessToken: minecraft.access_token };
  if (isTauri()) await invoke("store_auth_secret", { value: token.refresh_token });
  saveAccount(account);
  return account;
}

export async function loginWithMicrosoft(onCode: (info: DeviceCodeInfo) => void): Promise<LauncherAccount> {
  if (!CLIENT_ID) throw new Error("VITE_MICROSOFT_CLIENT_ID가 설정되지 않았습니다.");
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  const device = await response.json() as { device_code: string; user_code: string; verification_uri: string; message: string; expires_in: number; interval: number };
  if (!response.ok) throw new Error("Microsoft 로그인 코드를 만들지 못했습니다.");
  onCode({ userCode: device.user_code, verificationUri: device.verification_uri, message: device.message });
  if (isTauri()) await invoke("open_external_url", { url: device.verification_uri });

  const deadline = Date.now() + device.expires_in * 1000;
  let interval = device.interval * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, interval));
    const tokenResponse = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: CLIENT_ID, device_code: device.device_code }),
    });
    const payload = await tokenResponse.json() as MicrosoftToken & { error?: string };
    if (tokenResponse.ok) return exchangeForMinecraft(payload);
    if (payload.error === "slow_down") interval += 5000;
    else if (payload.error !== "authorization_pending") throw new Error("Microsoft 로그인이 취소되었거나 만료됐습니다.");
  }
  throw new Error("Microsoft 로그인 시간이 만료됐습니다.");
}

export async function restoreAccount(): Promise<LauncherAccount | null> {
  const stored = getStoredAccount();
  if (!stored) return null;
  if (stored.kind === "preview") return stored;
  if (!CLIENT_ID || !isTauri()) return null;
  const refreshToken = await invoke<string | null>("load_auth_secret");
  if (!refreshToken) return null;
  const token = await tokenRequest(new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE }));
  return exchangeForMinecraft(token);
}

export function createPreviewAccount(): LauncherAccount {
  const account: LauncherAccount = { id: "preview", name: "Preview Player", kind: "preview" };
  saveAccount(account);
  return account;
}

export async function logoutAccount(): Promise<void> {
  localStorage.removeItem(ACCOUNT_KEY);
  if (isTauri()) await invoke("delete_auth_secret");
}
