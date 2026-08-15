import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import App from "./App";
import { initializeLogBridge } from "./services/logService";
import "./styles/global.css";

if ("__TAURI_INTERNALS__" in window) {
  void getCurrentWebview().setZoom(1.1).catch((error) => console.warn("UI 배율을 적용하지 못했습니다.", error));
}
initializeLogBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
