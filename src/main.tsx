import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Banner vanilla di luar React agar tetap tampil apa pun kondisi app.
    if (document.getElementById("sw-update-bar")) return;
    const bar = document.createElement("div");
    bar.id = "sw-update-bar";
    bar.style.cssText =
      "position:fixed;bottom:76px;left:50%;transform:translateX(-50%);z-index:99;display:flex;gap:12px;align-items:center;background:#0b1220;color:#fff;padding:10px 16px;border-radius:14px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.25)";
    bar.textContent = "Versi baru tersedia.";
    const btn = document.createElement("button");
    btn.textContent = "Muat ulang";
    btn.style.cssText =
      "background:#f59e0b;color:#0b1220;font-weight:600;border:none;border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer";
    btn.onclick = () => updateSW(true);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  },
});

// Minta browser tidak menghapus IndexedDB saat storage menipis —
// seluruh data bisnis hidup di sini.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
