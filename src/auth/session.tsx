import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import type { User } from "@/db/types";
import { hashPin, verifyPin } from "./pin";

const SESSION_KEY = "lumen.session.userId";

interface SessionCtx {
  user: User | null;
  ready: boolean;
  hasUsers: boolean;
  login: (username: string, pin: string) => Promise<boolean>;
  logout: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(() =>
    localStorage.getItem(SESSION_KEY),
  );
  const users = useLiveQuery(() => db.users.toArray(), []);
  const ready = users !== undefined;
  const user =
    (userId && users?.find((u) => u.id === userId && u.active)) || null;

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
        localStorage.removeItem(SESSION_KEY);
        setUserId(null);
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(iv);
    };
  }, [user?.id]);

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

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setUserId(null);
  }

  return (
    <Ctx.Provider
      value={{ user, ready, hasUsers: (users?.length ?? 0) > 0, login, logout }}
    >
      {children}
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

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, hasUsers } = useSession();
  const loc = useLocation();
  if (!ready) return null;
  if (!hasUsers) return <Navigate to="/app/setup" replace />;
  if (!user)
    return <Navigate to="/app/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function RequireOwner({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (user?.role !== "owner")
    return (
      <div className="p-6 text-center text-sm text-slate-500">
        Halaman ini khusus Owner.
      </div>
    );
  return <>{children}</>;
}
