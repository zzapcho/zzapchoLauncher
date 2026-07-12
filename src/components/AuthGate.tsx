import { useEffect, useState, type ReactNode } from "react";
import { loginWithMicrosoft, logoutAccount, restoreAccount, type DeviceCodeInfo } from "../services/authService";
import type { LauncherAccount } from "../types/auth";
import { WindowActionButtons } from "./WindowControls";

function LoginStatus({ deviceCode }: { deviceCode: DeviceCodeInfo | null }) {
  return <main className="login-screen">
    <div className="window-titlebar login-titlebar" data-tauri-drag-region><WindowActionButtons maximize={false} close /></div>
    <div className="login-status">
      <span className="loader" />
      <p>로그인 중...</p>
      {deviceCode && <div className="device-code"><strong>{deviceCode.userCode}</strong><span>브라우저에서 이 코드를 입력하세요.</span><small>{deviceCode.verificationUri}</small></div>}
    </div>
  </main>;
}

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
    setError("");
    setLoggingIn(true);
    try { setAccount(await loginWithMicrosoft(setDeviceCode)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다."); }
    finally { setLoggingIn(false); setDeviceCode(null); }
  };

  const logout = async () => { await logoutAccount(); setAccount(null); };
  if (checking || loggingIn) return <LoginStatus deviceCode={deviceCode} />;
  if (account) return children(account, logout);

  return <main className="login-screen">
    <div className="window-titlebar login-titlebar" data-tauri-drag-region><WindowActionButtons maximize={false} close /></div>
    <div className="login-card">
      <span className="login-mark">z</span>
      <h1>zzapcho Launcher</h1>
      <p>Microsoft 계정으로 Minecraft에 로그인하세요.</p>
      <button className="microsoft-login" type="button" onClick={() => void login()}>Microsoft로 로그인</button>
      <small className="login-config">기본 브라우저에서 Microsoft 계정 로그인이 열립니다.</small>
      {error && <p className="login-error">{error}</p>}
    </div>
  </main>;
}
