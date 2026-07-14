import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  LayoutDashboard,
  Wrench,
  Smartphone,
  Wallet,
  Menu as MenuIcon,
  BarChart3,
  ClipboardCheck,
  ScrollText,
  Settings,
  Globe,
  LogOut,
  Cloud,
  CloudOff,
  RefreshCw,
  Check,
} from "lucide-react";
import { useSession, useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { db } from "@/db/db";
import { isCloud } from "@/db/supabase";
import { startSync, stopSync, useSyncStatus } from "@/db/sync";
import { cn } from "@/lib/cn";

export function SyncPill() {
  const s = useSyncStatus();
  if (!isCloud) return null;
  const map = {
    off: { icon: Cloud, text: "Cloud siap", cls: "text-slate-400" },
    idle: { icon: Check, text: "Tersinkron", cls: "text-emerald-400" },
    syncing: { icon: RefreshCw, text: "Menyinkron…", cls: "text-sky-400" },
    error: { icon: CloudOff, text: "Gagal sinkron", cls: "text-amber-400" },
    offline: { icon: CloudOff, text: "Offline", cls: "text-slate-400" },
  } as const;
  const m = map[s.state];
  const Icon = m.icon;
  return (
    <div className="flex items-center gap-1.5 px-2 text-[11px] font-medium text-slate-400">
      <Icon className={cn("size-3.5", m.cls, s.state === "syncing" && "animate-spin")} />
      <span className={m.cls}>{m.text}</span>
      {s.pending > 0 && (
        <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px]">
          {s.pending} antre
        </span>
      )}
    </div>
  );
}

const mainNav = [
  { to: "/app/beranda", label: "Beranda", icon: LayoutDashboard },
  { to: "/app/servis", label: "Servis", icon: Wrench },
  { to: "/app/stok", label: "Stok", icon: Smartphone },
  { to: "/app/kas", label: "Kas", icon: Wallet },
];

const moreNav = [
  { to: "/app/laporan", label: "Laporan", icon: BarChart3, moneyOnly: true, ownerOnly: false },
  { to: "/app/koreksi", label: "Koreksi", icon: ClipboardCheck, ownerOnly: false },
  { to: "/app/audit", label: "Audit Log", icon: ScrollText, ownerOnly: true },
  { to: "/app/pengaturan", label: "Pengaturan", icon: Settings, ownerOnly: false },
];

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  headops: "Head Operasional",
  kasir: "Kasir",
  teknisi: "Teknisi",
};

export function AppShell() {
  const user = useUser();
  const { logout } = useSession();
  const nav = useNavigate();
  const pendingCorrections = useLiveQuery(
    () => db.corrections.where("status").equals("pending").count(),
    [],
  );

  // Jalankan mesin sinkronisasi cloud selama sesi berlangsung.
  useEffect(() => {
    startSync();
    return () => stopSync();
  }, []);

  const navItem = (
    to: string,
    label: string,
    Icon: typeof LayoutDashboard,
    badge?: number,
  ) => (
    <NavLink
      key={to}
      to={to}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-white/10 text-white"
            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
        )
      }
    >
      <Icon className="size-4.5 shrink-0" />
      {label}
      {!!badge && (
        <span className="ml-auto rounded-full bg-accent-500 px-1.5 text-xs font-bold text-brand-950">
          {badge}
        </span>
      )}
    </NavLink>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-950 p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent-500 text-lg font-black text-brand-950">
            L
          </div>
          <div>
            <p className="text-sm font-bold text-white">Lumen Service</p>
            <p className="text-[11px] text-slate-400">Sistem Operasional</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {mainNav.map((n) => navItem(n.to, n.label, n.icon))}
          <div className="my-2 border-t border-white/10" />
          {moreNav
            .filter((n) => !n.ownerOnly || user.role === "owner")
            .filter(
              (n) =>
                !("moneyOnly" in n && n.moneyOnly) || canSeeMoney(user.role),
            )
            .map((n) =>
              navItem(
                n.to,
                n.label,
                n.icon,
                n.to === "/app/koreksi" ? pendingCorrections : undefined,
              ),
            )}
          {navItem("/", "Web Publik", Globe)}
        </nav>
        <div className="mb-2">
          <SyncPill />
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/5 p-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">
              {user.name}
            </p>
            <p className="text-[10px] text-slate-400">{ROLE_LABEL[user.role]}</p>
          </div>
          <button
            onClick={() => {
              logout();
              nav("/app/login");
            }}
            className="text-slate-400 hover:text-white"
            aria-label="Keluar"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Konten */}
      <main className="min-w-0 flex-1 pb-20 lg:ml-60 lg:pb-8">
        <Outlet />
      </main>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-5">
          {mainNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                  isActive ? "text-brand-600" : "text-slate-400",
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/app/menu"
            className={({ isActive }) =>
              cn(
                "relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                isActive ? "text-brand-600" : "text-slate-400",
              )
            }
          >
            <MenuIcon className="size-5" />
            Lainnya
            {!!pendingCorrections && (
              <span className="absolute right-4 top-1 size-2 rounded-full bg-accent-500" />
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  action,
  back,
}: {
  title: string;
  action?: React.ReactNode;
  back?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-8">
        {back}
        <h1 className="min-w-0 flex-1 truncate text-base font-bold lg:text-lg">
          {title}
        </h1>
        {action}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 lg:p-8">{children}</div>
  );
}
