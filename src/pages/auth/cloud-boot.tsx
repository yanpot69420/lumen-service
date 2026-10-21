import { useSession } from "@/auth/session";
import { cloudStatus, isCloud } from "@/db/cloud";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

/** A cloud response can change navigation, never erase a local database. */
export function CloudBoot() {
  const { hasUsers, ready: sessionReady } = useSession();
  const loc = useLocation();
  const [remoteUsers, setRemoteUsers] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(!isCloud);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;
    void cloudStatus().then((result) => {
      if (cancelled) return;
      setRemoteUsers(result.ok ? result.hasUsers : null); setChecked(true);
    }).catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (!isCloud) return <Outlet />;
  if (!sessionReady || (!checked && !hasUsers)) return <div className="p-8 text-center">Menghubungkan…</div>;
  if (checked && remoteUsers === null && !hasUsers && loc.pathname !== "/app/login") return (
    <div className="mx-auto max-w-md space-y-4 p-8 text-sm"><p>Cloud belum dapat dihubungi. Data perangkat tidak dihapus.</p><button className="underline" onClick={() => { setChecked(false); setAttempt((n) => n + 1); }}>Coba hubungkan lagi</button></div>
  );
  if (!hasUsers && remoteUsers === true && loc.pathname !== "/app/login") return <Navigate to="/app/login" replace />;
  if (!hasUsers && remoteUsers === false && loc.pathname !== "/app/setup") return <Navigate to="/app/setup" replace />;
  return <Outlet />;
}
