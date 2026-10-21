import { canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { BackupReminder } from "@/components/backup-reminder";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kpi } from "@/components/ui/misc";
import { TicketStatusTag } from "@/components/ui/status-tag";
import { sumCash } from "@/db/cash";
import { db } from "@/db/db";
import { ticketTotal } from "@/db/tickets";
import type { Ticket } from "@/db/types";
import { dayKey, daysSince, rp } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Package,
  Plus,
  ShoppingCart,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function BerandaPage() {
  const user = useUser();
  const today = dayKey();
  const todayCash = useLiveQuery(
    () => db.cash.where("dayKey").equals(today).toArray(),
    [today],
  );
  const tickets = useLiveQuery(() => db.tickets.toArray(), []);
  const units = useLiveQuery(() => db.units.where("status").equals("stok").toArray(), []);
  const parts = useLiveQuery(() => db.parts.toArray(), []);
  const pendingKoreksi = useLiveQuery(
    () => db.corrections.where("status").equals("pending").count(),
    [],
  );

  const { masuk, keluar } = sumCash(todayCash ?? []);
  const aktif = (tickets ?? []).filter(
    (t) => t.status !== "diambil" && t.status !== "batal",
  );
  const siapDiambil = aktif.filter((t) => t.status === "selesai");
  const lowParts = (parts ?? []).filter((p) => p.stok <= p.minStok);
  const stokLama = (units ?? []).filter((u) => daysSince(u.boughtAt) > 60);
  const modalLama = stokLama.reduce((s, u) => s + u.hargaBeli, 0);
  const piutangTotal = (tickets ?? []).reduce((s, t) => s + (t.piutang ?? 0), 0);
  const checking = aktif.filter((t) => t.status === "dicek");
  const priorityTickets = [...aktif].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 5);
  const money = canSeeMoney(user.role);
  const attentionCount = Number((pendingKoreksi ?? 0) > 0) + Number(lowParts.length > 0) + Number(money && piutangTotal > 0) + Number(money && stokLama.length > 0);

  return (
    <>
      <div className="mobile-root-page lg:hidden">
        <PageBody>
          <div className="flex items-center justify-between gap-3 pb-1 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-[#f5bd45] text-xl font-black text-[#10221f]">L<span className="text-white">.</span></div>
              <div>
                <p className="text-base font-extrabold tracking-tight text-[#10221f]">Lumen<span className="font-normal"> Service</span></p>
                <p className="mt-0.5 text-[11px] text-slate-500">{new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Makassar", weekday: "long", day: "numeric", month: "long" })}</p>
              </div>
            </div>
            <Link to="/app/menu" aria-label={`Menu akun ${user.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#e1e7dc] text-sm font-bold text-[#10221f] shadow-sm">
              {user.name.slice(0, 1).toUpperCase()}
            </Link>
          </div>

          <div className="pb-1 pt-2">
            <p className="text-xs font-medium text-slate-500">Ruang kerja Anda</p>
            <h1 className="mt-1 text-[25px] font-bold tracking-tight text-[#10221f]">Halo, {user.name.split(" ")[0]} <span className="text-[#b27a15]">✦</span></h1>
          </div>

          <section className="overflow-hidden rounded-[28px] bg-[#10221f] p-5 text-white shadow-[0_10px_28px_-16px_rgba(16,34,31,0.5)]" aria-label="Ringkasan operasional">
            <Link to="/app/servis?status=aktif" className="flex min-h-12 items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-white/60">Antrean di meja servis</p>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span className="text-[48px] font-semibold leading-none tracking-tight tabular-nums">{tickets === undefined ? "…" : aktif.length}</span>
                  <span className="text-sm text-white/70">servis aktif</span>
                </div>
              </div>
              <span className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/5"><ArrowUpRight className="size-5 text-[#f5bd45]" /></span>
            </Link>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link to="/app/servis?status=dicek" className="flex min-h-[72px] items-center gap-3 rounded-[18px] bg-white/[0.07] p-3">
                <Clock3 className="size-5 shrink-0 text-[#e9c985]" />
                <div><p className="text-xl font-semibold leading-tight tabular-nums">{tickets === undefined ? "…" : checking.length}</p><p className="mt-0.5 text-[11px] text-white/60">Sedang dicek</p></div>
              </Link>
              <Link to="/app/servis?status=selesai" className="flex min-h-[72px] items-center gap-3 rounded-[18px] bg-[#f5bd45] p-3 text-[#10221f]">
                <CheckCheck className="size-5 shrink-0" />
                <div><p className="text-xl font-semibold leading-tight tabular-nums">{tickets === undefined ? "…" : siapDiambil.length}</p><p className="mt-0.5 text-[11px] text-[#10221f]/75">Siap diambil</p></div>
              </Link>
            </div>
            {money && <Link to="/app/kas" className="mt-4 flex min-h-12 items-center gap-3 border-t border-white/10 pt-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10"><Wallet className="size-4 text-[#e9c985]" /></span>
              <div className="min-w-0 flex-1"><p className="text-[11px] text-white/60">Arus kas hari ini</p><p className="mt-0.5 text-base font-semibold tabular-nums">{todayCash === undefined ? "…" : rp(masuk - keluar)}</p></div>
              <ChevronRight className="size-4 text-white/50" />
            </Link>}
          </section>

          <div className="grid grid-cols-2 gap-3">
            <MobileQuickLink to="/app/pelanggan" icon={<Users className="size-5" />} label="Pelanggan" hint="Data & riwayat" />
            {money
              ? <MobileQuickLink to="/app/stok/beli" icon={<Smartphone className="size-5" />} label="Beli unit" hint="Terima HP masuk" />
              : <MobileQuickLink to="/app/stok?tab=part" icon={<Package className="size-5" />} label="Sparepart" hint="Cek ketersediaan" />}
          </div>

          {attentionCount > 0 && <details className="group overflow-hidden rounded-[24px] border border-[#eadfc3] bg-[#fffbf0]">
            <summary className="flex min-h-[76px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#f9eccb] text-[#a56d11]"><AlertTriangle className="size-[18px]" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#10221f]">{attentionCount} pengingat operasional</span><span className="mt-1 block text-[11px] text-slate-500">Ketuk untuk melihat yang perlu perhatian</span></span>
              <ChevronDown className="size-4 shrink-0 text-[#a56d11] transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-[#eadfc3] bg-white px-4">
              {(pendingKoreksi ?? 0) > 0 && <MobileReminder to="/app/koreksi" icon={<AlertTriangle className="size-[18px]" />} title={`${pendingKoreksi} koreksi menunggu`} hint="Lihat permintaan persetujuan" />}
              {lowParts.length > 0 && <MobileReminder to="/app/stok?tab=part&stock=perlu-restok" icon={<Package className="size-[18px]" />} title={`${lowParts.length} sparepart perlu restok`} hint="Stok mencapai batas minimum" />}
              {money && piutangTotal > 0 && <MobileReminder to="/app/servis?status=piutang" icon={<ArrowDownLeft className="size-[18px]" />} title={`${rp(piutangTotal)} belum dibayar`} hint="Lihat nota dengan sisa pembayaran" />}
              {money && stokLama.length > 0 && <MobileReminder to="/app/laporan" icon={<Smartphone className="size-[18px]" />} title={`${stokLama.length} unit di stok lebih dari 60 hari`} hint="Tinjau perputaran stok di laporan" />}
            </div>
          </details>}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <div><h2 className="text-base font-bold text-[#10221f]">Antrean servis</h2><p className="mt-0.5 text-[11px] text-slate-500">Mulai dari yang menunggu lebih lama</p></div>
              <Link to="/app/servis" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-[#416255]">Semua <ChevronRight className="size-3.5" /></Link>
            </div>
            {tickets === undefined ? <p className="rounded-[24px] bg-white p-6 text-center text-sm text-slate-500" role="status">Memuat antrean servis…</p> : priorityTickets.length > 0 ? <div className="space-y-2.5">{priorityTickets.map((ticket) => <MobileTicket key={ticket.id} ticket={ticket} />)}</div> : <div className="rounded-[24px] bg-white p-7 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#f4f5f0] text-[#416255]"><Wrench className="size-6" /></span>
              <p className="mt-3 text-sm font-semibold text-[#10221f]">Belum ada antrean servis</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Buat nota saat pelanggan menitipkan perangkat.</p>
              <Link to="/app/servis/baru" className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#f5bd45] px-5 text-sm font-semibold text-[#10221f]"><Plus className="size-4" /> Buat nota</Link>
            </div>}
          </section>
          <BackupReminder hasData={(todayCash?.length ?? 0) > 0 || aktif.length > 0} />
        </PageBody>
      </div>
      <div className="hidden lg:block">
      <PageHeader title={`Halo, ${user.name.split(" ")[0]} 👋`} />
      <PageBody>
        {/* Aksi cepat */}
        <div className={`grid ${canSeeMoney(user.role) ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
          <Link
            to="/app/servis/baru"
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-brand-950 p-4 text-white"
          >
            <Plus className="size-5 text-accent-500" />
            <span className="text-xs font-semibold">Nota Servis</span>
          </Link>
          {canSeeMoney(user.role) && <Link
            to="/app/stok/beli"
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <Smartphone className="size-5 text-brand-600" />
            <span className="text-xs font-semibold">Beli Unit</span>
          </Link>}
          <Link
            to="/app/stok"
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <ShoppingCart className="size-5 text-brand-600" />
            <span className="text-xs font-semibold">Jual Cepat</span>
          </Link>
        </div>

        {/* KPI hari ini */}
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Masuk hari ini" value={rp(masuk)} tone="positive" />
          <Kpi label="Keluar hari ini" value={rp(keluar)} tone="negative" />
          <Kpi label="Servis aktif" value={String(aktif.length)} />
        </div>

        {/* Peringatan */}
        {(pendingKoreksi ?? 0) > 0 && (
          <Link
            to="/app/koreksi"
            className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800"
          >
            <AlertTriangle className="size-4" />
            {pendingKoreksi} koreksi menunggu persetujuan Owner
            <ChevronRight className="ml-auto size-4" />
          </Link>
        )}
        {lowParts.length > 0 && (
          <Link
            to="/app/stok"
            className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
          >
            <AlertTriangle className="size-4" />
            {lowParts.length} sparepart menipis: {lowParts.slice(0, 3).map((p) => p.nama).join(", ")}
            {lowParts.length > 3 && "…"}
            <ChevronRight className="ml-auto size-4 shrink-0" />
          </Link>
        )}
        {canSeeMoney(user.role) && stokLama.length > 0 && (
          <Link
            to="/app/laporan"
            className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800"
          >
            <AlertTriangle className="size-4" />
            {stokLama.length} unit HP mengendap &gt;60 hari — modal {rp(modalLama)} parkir di stok
            <ChevronRight className="ml-auto size-4 shrink-0" />
          </Link>
        )}
        {piutangTotal > 0 && (
          <Link
            to="/app/servis"
            className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
          >
            <AlertTriangle className="size-4" />
            Piutang pelanggan {rp(piutangTotal)} belum dibayar
            <ChevronRight className="ml-auto size-4 shrink-0" />
          </Link>
        )}
        <BackupReminder hasData={(todayCash?.length ?? 0) > 0 || aktif.length > 0} />

        {/* Antrean */}
        <Card>
          <CardHeader>
            <CardTitle>
              Antrean servis{" "}
              {siapDiambil.length > 0 && (
                <span className="text-emerald-600">
                  · {siapDiambil.length} siap diambil
                </span>
              )}
            </CardTitle>
            <Link to="/app/servis" className="text-xs font-medium text-brand-600">
              Lihat semua
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            {aktif.length === 0 && (
              <p className="text-sm text-slate-400">
                Tidak ada servis aktif. Santai dulu ☕
              </p>
            )}
            {aktif.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                to={`/app/servis/${t.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:border-brand-200"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {t.brand} {t.model}
                    <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                      {t.noNota}
                    </span>
                  </p>
                  <p className="truncate text-xs text-slate-500">{t.customerName}</p>
                </div>
                <TicketStatusTag status={t.status} />
                <span className="text-xs font-semibold tabular-nums">
                  {rp(ticketTotal(t))}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </PageBody>
      </div>
    </>
  );
}

function MobileQuickLink({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint: string }) {
  return <Link to={to} className="flex min-h-[90px] flex-col items-start gap-2.5 rounded-[24px] bg-white p-4 shadow-[0_2px_10px_-5px_rgba(16,34,31,0.1)] min-[360px]:flex-row min-[360px]:items-center">
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#eef1e8] text-[#416255]">{icon}</span>
    <span className="min-w-0"><span className="block text-[13px] font-bold text-[#10221f]">{label}</span><span className="mt-1 block text-[10px] text-slate-500">{hint}</span></span>
  </Link>;
}

function MobileReminder({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint: string }) {
  return <Link to={to} className="flex min-h-[76px] items-center gap-3 border-b border-slate-100 py-3 last:border-0">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fff5da] text-[#a56d11]">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-[#10221f]">{title}</span><span className="mt-1 block text-[11px] text-slate-500">{hint}</span></span>
    <ChevronRight className="size-4 shrink-0 text-slate-300" />
  </Link>;
}

function MobileTicket({ ticket }: { ticket: Ticket }) {
  const waitingDays = Math.max(0, daysSince(ticket.updatedAt));
  return <Link to={`/app/servis/${ticket.id}`} className="block rounded-[24px] bg-white p-4 shadow-[0_2px_10px_-6px_rgba(16,34,31,0.1)]">
    <div className="mb-3 flex items-center justify-between gap-2"><TicketStatusTag status={ticket.status} /><span className="text-[10px] text-slate-400">{waitingDays === 0 ? "Diperbarui hari ini" : `${waitingDays} hari belum diperbarui`}</span></div>
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4f5f0] text-[#708276]"><Smartphone className="size-5" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold tracking-tight text-[#10221f]">{ticket.brand} {ticket.model}</p><p className="mt-1 truncate text-xs text-slate-500">{ticket.customerName} · {ticket.keluhan}</p></div>
      <ChevronRight className="size-4 shrink-0 text-slate-300" />
    </div>
    <p className="mt-3 border-t border-slate-100 pt-2.5 font-mono text-[10px] text-slate-400">{ticket.noNota}</p>
  </Link>;
}
