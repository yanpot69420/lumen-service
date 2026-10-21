import { canSeeMoney } from "@/auth/roles";
import { useSession, useUser } from "@/auth/session";
import { BrandMark } from "@/components/brand";
import { db } from "@/db/db";
import { isCloud } from "@/db/supabase";
import { startSync, stopSync, syncNow, useSyncStatus } from "@/db/sync";
import { cn } from "@/lib/cn";
import { BRAND_NAME } from "@/lib/brand";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart3,
  Check,
  ClipboardCheck,
  Cloud,
  CloudOff,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";

export function SyncPill({ light = false }: { light?: boolean; }) {
  const s = useSyncStatus();
  if (!isCloud) return null;
  const map = {
    off: { icon: Cloud, text: "Cloud terkunci", cls: "text-slate-400" },
    idle: { icon: Check, text: "Tersinkron", cls: "text-brand-200" },
    syncing: { icon: RefreshCw, text: "Menyinkron…", cls: "text-accent-400" },
    error: { icon: CloudOff, text: "Gagal sinkron", cls: "text-accent-400" },
    offline: { icon: CloudOff, text: "Offline", cls: "text-slate-400" },
  } as const;
  const m = map[s.state];
  const Icon = m.icon;
  const tone = light ? ({ off: "text-slate-500", idle: "text-brand-700", syncing: "text-accent-700", error: "text-accent-700", offline: "text-slate-500" } as const)[s.state] : m.cls;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 px-2 text-[11px] font-medium", light ? "text-slate-500" : "text-slate-400")} role="status">
      <Icon className={cn("size-3.5", tone, s.state === "syncing" && "animate-spin")} />
      <span className={tone}>{m.text}</span>
      {s.error && <span className={cn("w-full break-words", light ? "text-accent-700" : "text-accent-400")}>{s.error}</span>}
      {s.state === "error" && <><button onClick={() => { void syncNow(); }} className="underline">Coba lagi</button><NavLink to="/app/pengaturan" className="underline">Simpan backup</NavLink></>}
      {s.pending > 0 && (
        <span className={cn("ml-auto rounded-full px-1.5 text-[10px]", light ? "bg-brand-100 text-brand-700" : "bg-white/10")}>
          {s.pending} antre
        </span>
      )}
    </div>
  );
}

const mainNav = [
  { to: "/app/beranda", label: "Beranda", icon: LayoutDashboard },
  { to: "/app/servis", label: "Servis", icon: Wrench },
  { to: "/app/pelanggan", label: "Pelanggan", icon: Users },
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
  const visibleMainNav = mainNav.filter((n) => n.to !== "/app/kas" || canSeeMoney(user.role));
  const { logout } = useSession();
  const nav = useNavigate();
  const { pathname, key: routeKey } = useLocation();
  const navigationType = useNavigationType();
  const scrollPositions = useRef(new Map<string, number>());
  const previousPath = useRef("");
  const moreActive = !["/app/beranda", "/app/servis", "/app/stok"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  useLayoutEffect(() => {
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    if (previousPath.current !== pathname) window.scrollTo(0, navigationType === "POP" ? scrollPositions.current.get(routeKey) ?? 0 : 0);
    previousPath.current = pathname;
    return () => { scrollPositions.current.set(routeKey, window.scrollY); };
  }, [pathname, routeKey, navigationType]);
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
          "desktop-nav-item relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors",
          isActive && "is-active",
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
    <div className="app-shell min-h-dvh lg:flex">
      {/* Sidebar desktop */}
      <aside aria-label="Sidebar ruang kerja" className="desktop-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col p-4 lg:flex">
        <Link to="/app/beranda" className="mb-7 mt-2 flex items-center gap-2.5 px-2">
          <BrandMark />
          <div>
            <p className="text-sm font-bold tracking-tight text-brand-950">{BRAND_NAME}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Ruang kerja toko</p>
          </div>
        </Link>
        <Link to="/app/servis/baru" onClick={(event) => {
          if (pathname === "/app/servis/baru") { event.preventDefault(); window.dispatchEvent(new Event("lumen:new-service")); }
        }} className="mb-6 inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[14px] bg-accent-500 px-4 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400"><Plus className="size-4" /> Buat nota servis</Link>
        <nav aria-label="Navigasi ruang kerja" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
          <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.17em] text-slate-400">Operasional</p>
          {visibleMainNav.map((n) => navItem(n.to, n.label, n.icon))}
          <p className="mb-2 mt-5 px-3 text-[9px] font-semibold uppercase tracking-[.17em] text-slate-400">Pengelolaan</p>
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
          <div className="mt-3 border-t border-slate-100 pt-3">{navItem("/", "Web Publik", Globe)}</div>
        </nav>
        <div className="mb-2 mt-3 shrink-0">
          <SyncPill light />
        </div>
        <div className="mt-2 flex shrink-0 items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-200 text-xs font-bold text-brand-800">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <Link to="/app/pengaturan" aria-label="Pengaturan akun" className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-brand-950">
              {user.name}
            </p>
            <p className="text-[10px] text-slate-400">{ROLE_LABEL[user.role]}</p>
          </Link>
          <button
            onClick={async () => {
              await logout();
              nav("/app/login");
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-brand-700"
            aria-label="Keluar"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Konten */}
      <main id="main-content" className="app-main min-w-0 flex-1 pb-28 lg:ml-60 lg:pb-8">
        {isCloud && <div className="bg-brand-950 px-4 py-2 lg:hidden"><SyncPill /></div>}
        <Outlet />
      </main>

      {/* Bottom nav mobile */}
      <nav aria-label="Navigasi utama mobile" className="mobile-dock fixed inset-x-0 bottom-0 z-30 lg:hidden">
        <div className="mobile-dock-inner">
          {mainNav.slice(0, 2).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "mobile-dock-item",
                  isActive && "is-active",
                )
              }
            >
              <span className="mobile-dock-icon"><Icon className="size-5" /></span>
              {label}
            </NavLink>
          ))}
          <Link to="/app/servis/baru" onClick={(event) => {
            if (pathname === "/app/servis/baru") {
              event.preventDefault();
              window.dispatchEvent(new Event("lumen:new-service"));
            }
          }} aria-label="Buat nota servis baru" aria-current={pathname === "/app/servis/baru" ? "page" : undefined} className="mobile-dock-create">
            <span><Plus className="size-6" strokeWidth={2.5} /></span>
            <span>Nota baru</span>
          </Link>
          <NavLink to="/app/stok" className={({ isActive }) => cn("mobile-dock-item", isActive && "is-active")}>
            <span className="mobile-dock-icon"><Smartphone className="size-5" /></span>
            Stok
          </NavLink>
          <NavLink
            to="/app/menu"
            aria-current={moreActive ? "page" : undefined}
            className={cn("mobile-dock-item", moreActive && "is-active")}
          >
            <span className="mobile-dock-icon"><MenuIcon className="size-5" /></span>
            Menu
            {!!pendingCorrections && (
              <span className="absolute right-4 top-2 size-2 rounded-full bg-accent-500" />
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
  subtitle,
}: {
  title: string;
  action?: React.ReactNode;
  back?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <header className="page-header sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="page-header-inner flex h-14 items-center gap-3 px-4 lg:px-8">
        {back && <div className="page-header-back shrink-0">{back}</div>}
        <div className="min-w-0 flex-1">
          <p className="page-header-eyebrow"><span className="lg:hidden">{BRAND_NAME}</span><span className="hidden lg:inline">Ruang kerja · {BRAND_NAME}</span></p>
          <h1 className="page-header-title truncate text-base font-bold lg:text-lg">{title}</h1>
          {subtitle && <p className="mt-1 hidden text-xs text-slate-500 lg:block">{subtitle}</p>}
        </div>
        {action && <div className="page-header-action flex shrink-0 items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode; }) {
  return (
    <div className="page-body mx-auto max-w-5xl space-y-4 p-4 lg:p-8">{children}</div>
  );
}
