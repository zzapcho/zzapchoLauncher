import { useEffect, useState, type ReactNode } from "react";
import { createPreviewAccount, hasMicrosoftClientId, loginWithMicrosoft, logoutAccount, restoreAccount, type DeviceCodeInfo } from "../services/authService";
import type { LauncherAccount } from "../types/auth";

export function AuthGate({ children }: { children: (account: LauncherAccount, logout: () => Promise<void>) => ReactNode }) {
  const [account, setAccount] = useState<LauncherAccount | null>(null);
  const [checking, setChecking] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    restoreAccount().then(setAccount).catch(() => setAccount(null)).finally(() => setChecking(false));
  }, []);

  const login = async () => {
    setError(""); setLoggingIn(true);
    try { setAccount(await loginWithMicrosoft(setDeviceCode)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다."); }
    finally { setLoggingIn(false); setDeviceCode(null); }
  };

  const logout = async () => { await logoutAccount(); setAccount(null); };
  if (checking) return <main className="login-screen"><span className="loader" /><p>로그인 중...</p></main>;
  if (account) return children(account, logout);

  return <main className="login-screen">
    <div className="login-card">
      <span className="login-mark">z</span>
      <h1>zzapcho Launcher</h1>
      <p>Microsoft 계정으로 Minecraft에 로그인하세요.</p>
      {deviceCode && <div className="device-code"><small>{deviceCode.verificationUri}</small><strong>{deviceCode.userCode}</strong><span>브라우저에서 코드를 입력하세요.</span></div>}
      <button className="microsoft-login" type="button" disabled={!hasMicrosoftClientId || loggingIn} onClick={() => void login()}>{loggingIn ? "로그인 중..." : "Microsoft로 로그인"}</button>
      {!hasMicrosoftClientId && <small className="login-config">`.env`에 VITE_MICROSOFT_CLIENT_ID를 설정하면 실제 로그인이 활성화됩니다.</small>}
      <button className="preview-login" type="button" onClick={() => setAccount(createPreviewAccount())}>로그인 없이 둘러보기</button>
      {error && <p className="login-error">{error}</p>}
    </div>
  </main>;
}
