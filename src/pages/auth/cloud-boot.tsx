import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/auth/session";
import { isCloud, cloudStatus, cloudSignOut } from "@/db/cloud";
import { resetLocalCache } from "@/db/sync";

/**
 * Gerbang boot cloud: sekali saat aplikasi dibuka, cek ke server apakah toko
 * sudah di-setup. Bila cloud kosong (baru/di-reset), buang cache lokal yang
 * basi & arahkan ke Setup — sehingga keputusan setup-vs-login selalu mengikuti
 * cloud, bukan data lama di perangkat. Bila offline/error, lanjut pakai lokal.
 */
export function CloudBoot() {
  const { logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [ready, setReady] = useState(!isCloud);

  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;
    (async () => {
      const r = await cloudStatus();
      if (cancelled) return;
      if (r.ok && !r.hasUsers) {
        await resetLocalCache();
        await cloudSignOut();
        logout();
        if (!loc.pathname.startsWith("/app/setup"))
          nav("/app/setup", { replace: true });
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-950 text-xl font-black text-accent-500">
          L
        </div>
        <p className="text-sm text-slate-400">Menghubungkan…</p>
      </div>
    );
  return <Outlet />;
}
