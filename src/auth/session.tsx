import { cloudSignOut, forgetOfflineLogin, offlineSessionValid } from "@/db/cloud";
import { db } from "@/db/db";
import { isCloud, supabase } from "@/db/supabase";
import { startSync, stopSync } from "@/db/sync";
import type { User } from "@/db/types";
import { useLiveQuery } from "dexie-react-hooks";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { hashPin, verifyPin } from "./pin";

const SESSION_KEY = "lumen.session.userId";

interface SessionCtx {
  user: User | null;
  ready: boolean;
  hasUsers: boolean;
  login: (username: string, pin: string) => Promise<boolean>;
  adopt: (userId: string) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode; }) {
  const [userId, setUserId] = useState<string | null>(() =>
    localStorage.getItem(SESSION_KEY),
  );
  const users = useLiveQuery(() => db.users.toArray(), []);
  const [authReady, setAuthReady] = useState(!isCloud);
  const ready = users !== undefined && authReady;
  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;
    void (async () => {
      const candidate = localStorage.getItem(SESSION_KEY);
      const { data } = await supabase!.auth.getSession();
      const valid = candidate && (data.session?.user.email === `${candidate}@lumen.local` || (!navigator.onLine && await offlineSessionValid(candidate)));
      if (!valid) { localStorage.removeItem(SESSION_KEY); if (!cancelled) setUserId(null); }
      if (!cancelled) setAuthReady(true);
    })().catch(() => { if (!cancelled) { setUserId(null); setAuthReady(true); } });
    return () => { cancelled = true; };
  }, []);
  const user =
    (userId && users?.find((u) => u.id === userId && u.active)) || null;

  // The authenticated session owns sync, including standalone receipt routes.
  useLayoutEffect(() => {
    if (!ready || !user) return;
    startSync(user.id);
    return () => stopSync();
  }, [ready, user?.id, user?.role]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== SESSION_KEY) return;
      stopSync();
      // Never keep another account's mounted forms/modal state in this tab.
      setUserId(null);
      if (!event.newValue) return;
      if (!isCloud) { setUserId(event.newValue); return; }
      const candidate = event.newValue;
      void supabase!.auth.getSession().then(({ data }) => {
        if (localStorage.getItem(SESSION_KEY) === candidate && data.session?.user.email === `${candidate}@lumen.local`) setUserId(candidate);
      });
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  useEffect(() => {
    if (ready && userId && !user) {
      localStorage.removeItem(SESSION_KEY);
      setUserId(null);
    }
  }, [ready, userId, user]);

  // Kunci otomatis: 15 menit tanpa sentuhan → keluar (HP tergeletak di konter).
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 15 * 60_000;
    const bump = () => {
      lastActive.current = Date.now();
    };
    bump();
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const iv = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_MS) {
        void endSession(true);
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [user?.id]);
  useEffect(() => {
    const expired = () => { void endSession(false); };
    window.addEventListener("lumen:session-expired", expired);
    return () => window.removeEventListener("lumen:session-expired", expired);
  }, []);

  async function login(username: string, pin: string): Promise<boolean> {
    const u = await db.users
      .where("username")
      .equals(username.trim().toLowerCase())
      .first();
    if (!u || !u.active) return false;
    const { ok, needsUpgrade } = await verifyPin(u, pin);
    if (!ok) return false;
    if (needsUpgrade) {
      // Upgrade transparan hash lama (SHA-256) ke PBKDF2.
      await db.users.update(u.id, {
        pinHash: await hashPin(pin, u.salt),
        pinVer: 2,
      });
    }
    localStorage.setItem(SESSION_KEY, u.id);
    setUserId(u.id);
    return true;
  }

  /** Set sesi langsung berdasarkan id (dipakai setelah server memverifikasi
   *  PIN di mode cloud — hindari hashing PIN ulang di perangkat). */
  function adopt(userId: string) {
    localStorage.setItem(SESSION_KEY, userId);
    setUserId(userId);
  }

  async function endSession(keepOffline: boolean) {
    stopSync();
    localStorage.removeItem(SESSION_KEY); setUserId(null);
    if (isCloud) {
      if (!keepOffline) await forgetOfflineLogin();
      await cloudSignOut();
    }
  }
  async function logout() { await endSession(false); }

  return (
    <Ctx.Provider
      value={{
        user,
        ready,
        hasUsers: (users?.length ?? 0) > 0,
        login,
        adopt,
        logout,
      }}
    >
      <Fragment key={`${user?.id ?? "signed-out"}:${user?.role ?? ""}`}>{children}</Fragment>
    </Ctx.Provider>
  );
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession di luar SessionProvider");
  return ctx;
}

/** User login terjamin ada (dipakai di dalam RequireAuth). */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error("useUser dipanggil tanpa sesi login");
  return user;
}

export function RequireAuth({ children }: { children: ReactNode; }) {
  const { user, ready, hasUsers } = useSession();
  const loc = useLocation();
  if (!ready) return null;
  if (!hasUsers) return <Navigate to="/app/setup" replace />;
  if (!user)
    return <Navigate to="/app/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode; }) {
  const { user } = useSession();
  if (user?.role !== "owner")
    return (
      <div className="p-6 text-center text-sm text-slate-500">
        Halaman ini khusus Owner.
      </div>
    );
  return <>{children}</>;
}
