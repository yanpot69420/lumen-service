import { canSeeMoney } from "@/auth/roles";
import { useSession, useUser } from "@/auth/session";
import { PageBody, PageHeader, ROLE_LABEL } from "@/components/layout/app-shell";
import { db } from "@/db/db";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  Globe,
  LogOut,
  ScrollText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

export function MenuPage() {
  const user = useUser();
  const { logout } = useSession();
  const nav = useNavigate();
  const pending = useLiveQuery(
    () => db.corrections.where("status").equals("pending").count(),
    [],
  );

  const items = [
    { to: "/app/pelanggan", label: "Pelanggan", icon: Users },
    ...(canSeeMoney(user.role)
      ? [{ to: "/app/laporan", label: "Laporan", icon: BarChart3 }]
      : []),
    {
      to: "/app/koreksi",
      label: "Jurnal Koreksi",
      icon: ClipboardCheck,
      badge: pending,
    },
    ...(user.role === "owner"
      ? [{ to: "/app/audit", label: "Audit Log", icon: ScrollText }]
      : []),
    { to: "/app/pengaturan", label: "Pengaturan", icon: Settings },
    { to: "/", label: "Web Publik", icon: Globe },
  ];
  const mobileGroups = [
    {
      label: "Toko Anda",
      items: [
        { to: "/app/pelanggan", label: "Pelanggan", hint: "Data dan riwayat servis", icon: Users, badge: undefined },
        ...(canSeeMoney(user.role) ? [
          { to: "/app/kas", label: "Kas", hint: "Pemasukan dan pengeluaran", icon: Wallet, badge: undefined },
          { to: "/app/laporan", label: "Laporan", hint: "Pantau kinerja toko", icon: BarChart3, badge: undefined },
        ] : []),
      ],
    },
    {
      label: "Pengelolaan",
      items: [
        { to: "/app/koreksi", label: "Jurnal koreksi", hint: "Permintaan perbaikan transaksi", icon: ClipboardCheck, badge: pending },
        ...(user.role === "owner" ? [{ to: "/app/audit", label: "Audit log", hint: "Jejak aktivitas tim", icon: ScrollText, badge: undefined }] : []),
        { to: "/app/pengaturan", label: "Pengaturan", hint: "Akun, toko, dan penyimpanan", icon: Settings, badge: undefined },
        { to: "/", label: "Web publik", hint: "Buka halaman pelanggan", icon: Globe, badge: undefined },
      ],
    },
  ];

  async function signOut() {
    await logout();
    nav("/app/login");
  }

  return (
    <>
      <div className="mobile-root-page lg:hidden">
        <PageBody>
          <div className="pb-1 pt-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#708276]">Lumen Service</p><h1 className="mt-1 text-[27px] font-bold tracking-tight text-[#10221f]">Ruang kerja</h1></div>
          <div className="flex items-center gap-4 rounded-[28px] bg-[#10221f] p-5 text-white">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-[20px] bg-[#f5bd45] text-2xl font-bold text-[#10221f]">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0"><p className="truncate text-lg font-bold tracking-tight">{user.name}</p><span className="mt-1.5 inline-flex rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">{ROLE_LABEL[user.role]}</span></div>
          </div>
          {mobileGroups.map((group) => <section key={group.label} className="space-y-2.5 pt-1">
            <h2 className="px-1 text-xs font-semibold text-[#708276]">{group.label}</h2>
            <div className="overflow-hidden rounded-[24px] bg-white px-4">
              {group.items.map(({ to, label, hint, icon: Icon, badge }) => <Link key={to} to={to} className="flex min-h-[78px] items-center gap-3 border-b border-slate-100 py-3 last:border-0">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#f0f2eb] text-[#416255]"><Icon className="size-[19px]" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#10221f]">{label}</span><span className="mt-1 block text-[11px] text-slate-500">{hint}</span></span>
                {!!badge && <span className="flex min-w-5 items-center justify-center rounded-full bg-[#f5bd45] px-1.5 py-0.5 text-[10px] font-bold text-[#10221f]">{badge}</span>}
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </Link>)}
            </div>
          </section>)}
          <button type="button" onClick={() => { void signOut(); }} className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[22px] border border-[#e9dcd5] bg-[#fbf4ef] px-4 py-3 text-sm font-semibold text-[#a24c35]"><LogOut className="size-[18px]" /> Keluar dari akun</button>
          <p className="pb-1 pt-1 text-center text-[10px] tracking-wide text-[#869184]">Lumen Service · Sistem Operasional</p>
        </PageBody>
      </div>
      <div className="hidden lg:block">
      <PageHeader title="Lainnya" />
      <PageBody>
        <div className="flex items-center gap-3 rounded-2xl bg-brand-950 p-4 text-white">
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-700 text-base font-bold">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-bold">{user.name}</p>
            <p className="text-xs text-slate-300">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map(({ to, label, icon: Icon, badge }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 border-b border-slate-100 p-4 text-sm font-medium last:border-0 hover:bg-slate-50"
            >
              <Icon className="size-4.5 text-slate-400" />
              {label}
              {!!badge && (
                <span className="rounded-full bg-accent-500 px-2 text-xs font-bold text-brand-950">
                  {badge}
                </span>
              )}
              <ChevronRight className="ml-auto size-4 text-slate-300" />
            </Link>
          ))}
        </div>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <LogOut className="size-4.5" />
          Keluar
        </button>
      </PageBody>
      </div>
    </>
  );
}
