import { canSeeMoney } from "@/auth/roles";
import { useSession, useUser } from "@/auth/session";
import { PageBody, PageHeader, ROLE_LABEL } from "@/components/layout/app-shell";
import { readCorrectionsFor } from "@/db/access";
import { BRAND_NAME } from "@/lib/brand";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BarChart3,
  ArrowUpRight,
  ChevronRight,
  ClipboardCheck,
  Cloud,
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
    async () => (await readCorrectionsFor(user)).filter((row) => row.status === "pending").length,
    [user.id, user.role],
  );

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
        { to: "/app/sinkronisasi", label: "Pusat sinkronisasi", hint: "Status pengiriman dan akun pembuat", icon: Cloud, badge: undefined },
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
          <div className="pb-1 pt-2"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{BRAND_NAME}</p><h1 className="mt-1 text-[27px] font-bold tracking-tight text-brand-950">Ruang kerja</h1></div>
          <div className="flex items-center gap-4 rounded-[28px] bg-brand-950 p-5 text-white">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-[20px] bg-accent-500 text-2xl font-bold text-brand-950">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0"><p className="truncate text-lg font-bold tracking-tight">{user.name}</p><span className="mt-1.5 inline-flex rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">{ROLE_LABEL[user.role]}</span></div>
          </div>
          {mobileGroups.map((group) => <section key={group.label} className="space-y-2.5 pt-1">
            <h2 className="px-1 text-xs font-semibold text-slate-500">{group.label}</h2>
            <div className="overflow-hidden rounded-[24px] bg-white px-4">
              {group.items.map(({ to, label, hint, icon: Icon, badge }) => <Link key={to} to={to} className="flex min-h-[78px] items-center gap-3 border-b border-slate-100 py-3 last:border-0">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-slate-100 text-brand-700"><Icon className="size-[19px]" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-brand-950">{label}</span><span className="mt-1 block text-[11px] text-slate-500">{hint}</span></span>
                {!!badge && <span className="flex min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold text-brand-950">{badge}</span>}
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </Link>)}
            </div>
          </section>)}
          <button type="button" onClick={() => { void signOut(); }} className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"><LogOut className="size-[18px]" /> Keluar dari akun</button>
          <p className="pb-1 pt-1 text-center text-[10px] tracking-wide text-slate-500">{BRAND_NAME} · Sistem Operasional</p>
        </PageBody>
      </div>
      <div className="hidden lg:block">
        <PageHeader title="Ruang kerja" subtitle="Kelola toko dan akses pengaturan akun Anda." />
        <PageBody>
          <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white" aria-labelledby="desktop-account-title">
              <div className="relative overflow-hidden bg-brand-950 px-6 py-7 text-white">
                <div className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full border border-white/10" aria-hidden="true" />
                <p className="relative text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Akun Anda</p>
                <div className="relative mt-6 flex size-16 items-center justify-center rounded-[22px] bg-accent-500 text-2xl font-bold text-brand-950">{user.name.slice(0, 1).toUpperCase()}</div>
                <h2 id="desktop-account-title" className="relative mt-5 break-words text-xl font-bold tracking-tight">{user.name}</h2>
                <p className="relative mt-1 text-xs text-white/55">@{user.username}</p>
                <span className="relative mt-4 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80">{ROLE_LABEL[user.role]}</span>
              </div>
              <div className="px-6 py-5">
                <p className="text-xs leading-relaxed text-slate-500">Menu yang tersedia mengikuti peran akun Anda di toko.</p>
                <button type="button" onClick={() => { void signOut(); }} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"><LogOut className="size-4" /> Keluar dari akun</button>
              </div>
            </section>

            <div className="grid items-start gap-5 xl:grid-cols-2">
              {mobileGroups.map((group) => <section key={group.label} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white" aria-label={group.label}>
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-4"><h2 className="text-sm font-bold text-brand-950">{group.label}</h2><p className="mt-1 text-[11px] text-slate-500">{group.label === "Toko Anda" ? "Data pelanggan dan operasional harian" : "Kontrol, pengaturan, dan aktivitas toko"}</p></div>
                <div className="px-4 py-2">{group.items.map(({ to, label, hint, icon: Icon, badge }) => <Link key={to} to={to} className="group -mx-1 flex min-h-[90px] items-center gap-3 rounded-2xl px-2 py-4 transition-colors hover:bg-slate-50">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-[15px] bg-slate-100 text-brand-700"><Icon className="size-[19px]" /></span>
                  <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[13px] font-semibold text-brand-950">{label}{!!badge && <span className="flex min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold text-brand-950">{badge}</span>}</span><span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{hint}</span></span>
                  {to === "/" ? <ArrowUpRight className="size-4 shrink-0 text-slate-300 group-hover:text-brand-700" /> : <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-brand-700" />}
                </Link>)}</div>
              </section>)}
            </div>
          </div>
          <p className="pt-2 text-center text-[10px] tracking-wide text-slate-500">{BRAND_NAME} · Sistem Operasional</p>
        </PageBody>
      </div>
    </>
  );
}
