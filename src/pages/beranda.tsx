import { canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { BackupReminder } from "@/components/backup-reminder";
import { BrandMark } from "@/components/brand";
import { BRAND_NAME } from "@/lib/brand";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { TicketStatusTag } from "@/components/ui/status-tag";
import { sumCash } from "@/db/cash";
import { db } from "@/db/db";
import { readCorrectionsFor } from "@/db/access";
import { ticketTotal } from "@/db/tickets";
import type { Ticket } from "@/db/types";
import { dayKey, daysSince, fmtDate, fmtTime, rp } from "@/lib/format";
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
    async () => (await readCorrectionsFor(user)).filter((row) => row.status === "pending").length,
    [user.id, user.role],
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
  const desktopPriorityTickets = [...aktif].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, 6);
  const newTickets = aktif.filter((t) => t.status === "masuk");
  const waitingApproval = aktif.filter((t) => t.status === "konfirmasi");
  const working = aktif.filter((t) => t.status === "dikerjakan");
  const money = canSeeMoney(user.role);
  const attentionCount = Number((pendingKoreksi ?? 0) > 0) + Number(lowParts.length > 0) + Number(money && piutangTotal > 0) + Number(money && stokLama.length > 0);
  const operationalLoaded = tickets !== undefined && units !== undefined && parts !== undefined && pendingKoreksi !== undefined;

  return (
    <>
      <div className="mobile-root-page lg:hidden">
        <PageBody>
          <div className="flex items-center justify-between gap-3 pb-1 pt-1">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <div>
                <p className="text-base font-extrabold tracking-tight text-brand-950">{BRAND_NAME}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Makassar", weekday: "long", day: "numeric", month: "long" })}</p>
              </div>
            </div>
            <Link to="/app/menu" aria-label={`Menu akun ${user.name}`} className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-sm font-bold text-brand-950 shadow-sm">
              {user.name.slice(0, 1).toUpperCase()}
            </Link>
          </div>

          <div className="pb-1 pt-2">
            <p className="text-xs font-medium text-slate-500">Ruang kerja Anda</p>
            <h1 className="mt-1 text-[25px] font-bold tracking-tight text-brand-950">Halo, {user.name.split(" ")[0]} <span className="text-accent-600">✦</span></h1>
          </div>

          <section className="overflow-hidden rounded-[28px] bg-brand-950 p-5 text-white shadow-[0_10px_28px_-16px_rgba(0,0,0,0.5)]" aria-label="Ringkasan operasional">
            <Link to="/app/servis?status=aktif" className="flex min-h-12 items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-white/60">Antrean di meja servis</p>
                <div className="mt-2 flex items-baseline gap-2.5">
                  <span className="text-[48px] font-semibold leading-none tracking-tight tabular-nums">{tickets === undefined ? "…" : aktif.length}</span>
                  <span className="text-sm text-white/70">servis aktif</span>
                </div>
              </div>
              <span className="flex size-10 items-center justify-center rounded-full border border-white/15 bg-white/5"><ArrowUpRight className="size-5 text-accent-400" /></span>
            </Link>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link to="/app/servis?status=dicek" className="flex min-h-[72px] items-center gap-3 rounded-[18px] bg-white/[0.07] p-3">
                <Clock3 className="size-5 shrink-0 text-accent-300" />
                <div><p className="text-xl font-semibold leading-tight tabular-nums">{tickets === undefined ? "…" : checking.length}</p><p className="mt-0.5 text-[11px] text-white/60">Sedang dicek</p></div>
              </Link>
              <Link to="/app/servis?status=selesai" className="flex min-h-[72px] items-center gap-3 rounded-[18px] bg-accent-500 p-3 text-brand-950">
                <CheckCheck className="size-5 shrink-0" />
                <div><p className="text-xl font-semibold leading-tight tabular-nums">{tickets === undefined ? "…" : siapDiambil.length}</p><p className="mt-0.5 text-[11px] text-brand-950/75">Siap diambil</p></div>
              </Link>
            </div>
            {money && <Link to="/app/kas" className="mt-4 flex min-h-12 items-center gap-3 border-t border-white/10 pt-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10"><Wallet className="size-4 text-accent-300" /></span>
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

          {attentionCount > 0 && <details className="group overflow-hidden rounded-[24px] border border-accent-200 bg-accent-50">
            <summary className="flex min-h-[76px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-accent-100 text-accent-700"><AlertTriangle className="size-[18px]" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-brand-950">{attentionCount} pengingat operasional</span><span className="mt-1 block text-[11px] text-slate-500">Ketuk untuk melihat yang perlu perhatian</span></span>
              <ChevronDown className="size-4 shrink-0 text-accent-700 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-accent-200 bg-white px-4">
              {(pendingKoreksi ?? 0) > 0 && <MobileReminder to="/app/koreksi" icon={<AlertTriangle className="size-[18px]" />} title={`${pendingKoreksi} koreksi menunggu`} hint="Lihat permintaan persetujuan" />}
              {lowParts.length > 0 && <MobileReminder to="/app/stok?tab=part&stock=perlu-restok" icon={<Package className="size-[18px]" />} title={`${lowParts.length} sparepart perlu restok`} hint="Stok mencapai batas minimum" />}
              {money && piutangTotal > 0 && <MobileReminder to="/app/servis?status=piutang" icon={<ArrowDownLeft className="size-[18px]" />} title={`${rp(piutangTotal)} belum dibayar`} hint="Lihat nota dengan sisa pembayaran" />}
              {money && stokLama.length > 0 && <MobileReminder to="/app/laporan" icon={<Smartphone className="size-[18px]" />} title={`${stokLama.length} unit di stok lebih dari 60 hari`} hint="Tinjau perputaran stok di laporan" />}
            </div>
          </details>}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <div><h2 className="text-base font-bold text-brand-950">Antrean servis</h2><p className="mt-0.5 text-[11px] text-slate-500">Mulai dari yang menunggu lebih lama</p></div>
              <Link to="/app/servis" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-700">Semua <ChevronRight className="size-3.5" /></Link>
            </div>
            {tickets === undefined ? <p className="rounded-[24px] bg-white p-6 text-center text-sm text-slate-500" role="status">Memuat antrean servis…</p> : priorityTickets.length > 0 ? <div className="space-y-2.5">{priorityTickets.map((ticket) => <MobileTicket key={ticket.id} ticket={ticket} />)}</div> : <div className="rounded-[24px] bg-white p-7 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-50 text-brand-700"><Wrench className="size-6" /></span>
              <p className="mt-3 text-sm font-semibold text-brand-950">Belum ada antrean servis</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">Buat nota saat pelanggan menitipkan perangkat.</p>
              <Link to="/app/servis/baru" className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent-500 px-5 text-sm font-semibold text-brand-950"><Plus className="size-4" /> Buat nota</Link>
            </div>}
          </section>
          <BackupReminder hasData={(todayCash?.length ?? 0) > 0 || aktif.length > 0} />
        </PageBody>
      </div>
      <div className="hidden lg:block">
        <PageHeader
          title={`Halo, ${user.name.split(" ")[0]}`}
          subtitle={new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Makassar", weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        />
        <PageBody>
          <section className="relative overflow-hidden rounded-[28px] bg-brand-950 text-white" aria-label="Ringkasan operasional">
            <div className="pointer-events-none absolute -right-16 -top-32 size-96 rounded-full border border-white/[0.06]" aria-hidden="true" />
            <div className="pointer-events-none absolute -right-2 -top-20 size-72 rounded-full border border-white/[0.06]" aria-hidden="true" />
            <div className="relative flex items-center justify-between gap-8 px-7 py-7 xl:px-8">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Ruang kerja toko</p>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="text-[56px] font-semibold leading-none tracking-tight tabular-nums text-accent-400">{tickets === undefined ? "…" : aktif.length}</span>
                  <h2 className="text-xl font-medium tracking-tight">servis aktif</h2>
                </div>
                <p className="mt-3 text-sm text-white/60">{tickets === undefined ? "Memuat antrean servis Anda…" : aktif.length === 0 ? "Siap menerima perangkat pelanggan berikutnya." : `${siapDiambil.length} siap diambil · ${working.length} sedang dikerjakan`}</p>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-2.5">
                <Link to="/app/servis/baru" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent-500 px-5 text-sm font-bold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-500"><Plus className="size-[18px]" /> Buat nota servis</Link>
                <Link to="/app/servis?status=aktif" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white">Buka antrean <ArrowUpRight className="size-4" /></Link>
              </div>
            </div>
            <div className="relative grid grid-cols-4 border-t border-white/10 bg-white/[0.025] px-4">
              {[
                { to: "/app/servis?status=masuk", label: "Baru masuk", count: newTickets.length },
                { to: "/app/servis?status=dicek", label: "Sedang dicek", count: checking.length },
                { to: "/app/servis?status=konfirmasi", label: "Menunggu konfirmasi", count: waitingApproval.length },
                { to: "/app/servis?status=selesai", label: "Siap diambil", count: siapDiambil.length },
              ].map((item) => <Link key={item.to} to={item.to} className="group my-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-white/5">
                <span className="text-xs text-white/60 group-hover:text-white/90">{item.label}</span>
                <span className="text-lg font-semibold tabular-nums">{tickets === undefined ? "…" : item.count}</span>
              </Link>)}
            </div>
          </section>

          <div className={`grid gap-4 ${money ? "grid-cols-4" : "grid-cols-2"}`}>
            {money && <>
              <DesktopMetric to="/app/kas" label="Pemasukan hari ini" value={todayCash === undefined ? "…" : rp(masuk)} hint="Total kas masuk" icon={<ArrowDownLeft className="size-[18px]" />} />
              <DesktopMetric to="/app/kas" label="Pengeluaran hari ini" value={todayCash === undefined ? "…" : rp(keluar)} hint="Total kas keluar" icon={<ArrowUpRight className="size-[18px]" />} />
            </>}
            <DesktopMetric to="/app/stok" label="Unit dalam stok" value={units === undefined ? "…" : String(units.length)} hint="Tersedia dalam stok" icon={<Smartphone className="size-[18px]" />} />
            <DesktopMetric to="/app/stok?tab=part&stock=perlu-restok" label="Sparepart menipis" value={parts === undefined ? "…" : String(lowParts.length)} hint="Mencapai batas minimum" icon={<Package className="size-[18px]" />} attention={lowParts.length > 0} />
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_310px]">
            <section className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white" aria-labelledby="desktop-queue-title">
              <div className="flex items-center justify-between gap-4 px-6 py-5">
                <div>
                  <div className="flex items-center gap-2.5"><h2 id="desktop-queue-title" className="text-base font-bold tracking-tight text-brand-950">Antrean servis</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">{tickets === undefined ? "…" : aktif.length} aktif</span></div>
                  <p className="mt-1.5 text-xs text-slate-500">Paling lama belum diperbarui ditampilkan lebih dulu.</p>
                </div>
                <Link to="/app/servis?status=aktif" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-950">Lihat semua <ChevronRight className="size-3.5" /></Link>
              </div>
              {tickets === undefined ? <div className="border-t border-slate-100 px-6 py-14 text-center" role="status"><Clock3 className="mx-auto size-6 text-brand-700" /><p className="mt-3 text-sm text-slate-500">Memuat antrean servis…</p></div> : desktopPriorityTickets.length === 0 ? <div className="border-t border-slate-100 px-6 py-12 text-center">
                <span className="mx-auto flex size-14 items-center justify-center rounded-[20px] bg-slate-100 text-brand-700"><Wrench className="size-6" /></span>
                <h3 className="mt-4 text-sm font-semibold text-brand-950">Belum ada antrean servis</h3>
                <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">Buat nota untuk mencatat perangkat, keluhan, dan kondisi saat diterima.</p>
                <Link to="/app/servis/baru" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent-500 px-4 text-xs font-bold text-brand-950"><Plus className="size-4" /> Buat nota pertama</Link>
              </div> : <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-xs">
                  <thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                    <tr><th className={`${money ? "w-[26%]" : "w-[29%]"} py-3 pl-6 pr-3 font-semibold`}>Perangkat / nota</th><th className={`${money ? "w-[20%]" : "w-[21%]"} px-3 py-3 font-semibold`}>Pelanggan</th><th className={`${money ? "w-[22%]" : "w-[23%]"} px-3 py-3 font-semibold`}>Status</th><th className={`${money ? "w-[14%]" : "w-[27%]"} px-3 py-3 font-semibold`}>Pembaruan</th>{money && <th className="w-[18%] py-3 pl-2 pr-6 text-right font-semibold">Tagihan</th>}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">{desktopPriorityTickets.map((ticket) => <DesktopTicket key={ticket.id} ticket={ticket} money={money} />)}</tbody>
                </table>
              </div>}
              {desktopPriorityTickets.length > 0 && <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3.5 text-[11px] text-slate-400"><span>Menampilkan {desktopPriorityTickets.length} dari {aktif.length} servis aktif</span><span>Pilih perangkat untuk membuka nota</span></div>}
            </section>

            <aside className="grid gap-5 lg:grid-cols-2 xl:grid-cols-1" aria-label="Pengingat dan akses cepat">
              <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5"><h2 className="text-sm font-bold text-brand-950">Perlu perhatian</h2>{attentionCount > 0 && <span className="flex size-6 items-center justify-center rounded-full bg-accent-100 text-[11px] font-bold text-accent-700">{attentionCount}</span>}</div>
                <div className="px-5 pb-2">
                  {!operationalLoaded ? <p className="py-5 text-xs text-slate-500" role="status">Memeriksa pengingat…</p> : attentionCount === 0 ? <div className="pb-5 pt-3"><CheckCheck className="size-6 text-brand-700" /><p className="mt-3 text-sm font-semibold text-brand-950">Tidak ada pengingat</p><p className="mt-1.5 text-xs leading-relaxed text-slate-500">Belum ada pengingat operasional yang perlu ditindaklanjuti.</p></div> : <>
                    {(pendingKoreksi ?? 0) > 0 && <DesktopReminder to="/app/koreksi" icon={<AlertTriangle className="size-4" />} title={`${pendingKoreksi} koreksi menunggu`} hint="Tinjau permintaan koreksi transaksi" />}
                    {lowParts.length > 0 && <DesktopReminder to="/app/stok?tab=part&stock=perlu-restok" icon={<Package className="size-4" />} title={`${lowParts.length} sparepart perlu restok`} hint={lowParts.slice(0, 2).map((part) => part.nama).join(", ")} />}
                    {money && piutangTotal > 0 && <DesktopReminder to="/app/servis?status=piutang" icon={<Wallet className="size-4" />} title={rp(piutangTotal)} hint="Sisa pembayaran pelanggan" />}
                    {money && stokLama.length > 0 && <DesktopReminder to="/app/laporan" icon={<Smartphone className="size-4" />} title={`${stokLama.length} unit tersimpan >60 hari`} hint={`${rp(modalLama)} modal dalam stok lama`} />}
                  </>}
                </div>
              </section>
              <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                <h2 className="mb-3 text-sm font-bold text-brand-950">Akses cepat</h2>
                <DesktopQuickLink to="/app/pelanggan" icon={<Users className="size-[18px]" />} label="Data pelanggan" hint="Kontak dan riwayat servis" />
                <DesktopQuickLink to="/app/stok?tab=part" icon={<Package className="size-[18px]" />} label="Stok sparepart" hint="Cek ketersediaan komponen" />
                {money && <DesktopQuickLink to="/app/stok/beli" icon={<Smartphone className="size-[18px]" />} label="Beli unit HP" hint="Catat unit yang baru masuk" />}
              </section>
            </aside>
          </div>
          <BackupReminder hasData={(todayCash?.length ?? 0) > 0 || aktif.length > 0} />
        </PageBody>
      </div>
    </>
  );
}

function DesktopMetric({ to, label, value, hint, icon, attention = false }: { to: string; label: string; value: string; hint: string; icon: ReactNode; attention?: boolean }) {
  return <Link to={to} className="group rounded-[22px] border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-slate-500">{label}</p><span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${attention ? "bg-accent-100 text-accent-700" : "bg-slate-100 text-brand-700"}`}>{icon}</span></div>
    <p className="mt-3 break-words text-[21px] font-bold leading-tight tracking-tight tabular-nums text-brand-950 xl:text-[24px]">{value}</p>
    <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>
  </Link>;
}

function DesktopTicket({ ticket, money }: { ticket: Ticket; money: boolean }) {
  const waitingDays = Math.max(0, daysSince(ticket.updatedAt));
  const today = dayKey(new Date(ticket.updatedAt)) === dayKey();
  const hasPrice = ticket.hargaFinal ?? ticket.biayaJasa > 0;
  return <tr className="group transition-colors hover:bg-slate-50">
    <td className="py-4 pl-6 pr-3 align-middle">
      <Link to={`/app/servis/${ticket.id}`} className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700">
        <span className="block truncate text-[13px] font-semibold text-brand-950 group-hover:text-brand-700">{ticket.brand} {ticket.model}</span>
        <span className="mt-1.5 block truncate font-mono text-[10px] text-slate-400">{ticket.noNota}</span>
      </Link>
    </td>
    <td className="px-3 py-4 align-middle"><p className="truncate text-xs font-medium text-slate-700">{ticket.customerName}</p><p className="mt-1.5 truncate text-[10px] text-slate-400">{ticket.keluhan}</p></td>
    <td className="px-3 py-4 align-middle"><TicketStatusTag status={ticket.status} /></td>
    <td className="px-3 py-4 align-middle"><p className={`text-[11px] ${waitingDays >= 3 ? "font-semibold text-accent-700" : "text-slate-600"}`}>{today ? "Hari ini" : fmtDate(ticket.updatedAt).replace(/ \d{4}$/, "")}</p><p className="mt-1.5 text-[10px] text-slate-400">{waitingDays > 0 ? `${waitingDays} hari lalu` : fmtTime(ticket.updatedAt)}</p></td>
    {money && <td className="py-4 pl-2 pr-6 text-right align-middle"><p className="break-words text-xs font-semibold tabular-nums text-brand-950">{hasPrice ? rp(ticketTotal(ticket)) : "—"}</p>{!hasPrice && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">Belum final</p>}</td>}
  </tr>;
}

function DesktopReminder({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint: string }) {
  return <Link to={to} className="group flex items-start gap-2.5 border-b border-slate-100 py-3.5 last:border-0">
    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold leading-relaxed text-brand-950 group-hover:text-brand-700">{title}</span><span className="mt-1 block text-[11px] leading-relaxed text-slate-500 [overflow-wrap:anywhere]">{hint}</span></span>
    <ChevronRight className="mt-2 size-3.5 shrink-0 text-slate-300 group-hover:text-brand-700" />
  </Link>;
}

function DesktopQuickLink({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint: string }) {
  return <Link to={to} className="group -mx-2 flex min-h-[68px] items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-slate-50">
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-slate-100 text-brand-700">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-brand-950">{label}</span><span className="mt-1 block text-[10px] text-slate-500">{hint}</span></span>
    <ArrowUpRight className="size-4 shrink-0 text-slate-300 group-hover:text-brand-700" />
  </Link>;
}

function MobileQuickLink({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint: string }) {
  return <Link to={to} className="flex min-h-[90px] flex-col items-start gap-2.5 rounded-[24px] bg-white p-4 shadow-[0_2px_10px_-5px_rgba(0,0,0,0.1)] min-[360px]:flex-row min-[360px]:items-center">
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-slate-100 text-brand-700">{icon}</span>
    <span className="min-w-0"><span className="block text-[13px] font-bold text-brand-950">{label}</span><span className="mt-1 block text-[10px] text-slate-500">{hint}</span></span>
  </Link>;
}

function MobileReminder({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint: string }) {
  return <Link to={to} className="flex min-h-[76px] items-center gap-3 border-b border-slate-100 py-3 last:border-0">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-brand-950">{title}</span><span className="mt-1 block text-[11px] text-slate-500">{hint}</span></span>
    <ChevronRight className="size-4 shrink-0 text-slate-300" />
  </Link>;
}

function MobileTicket({ ticket }: { ticket: Ticket }) {
  const waitingDays = Math.max(0, daysSince(ticket.updatedAt));
  return <Link to={`/app/servis/${ticket.id}`} className="block rounded-[24px] bg-white p-4 shadow-[0_2px_10px_-6px_rgba(0,0,0,0.1)]">
    <div className="mb-3 flex items-center justify-between gap-2"><TicketStatusTag status={ticket.status} /><span className="text-[10px] text-slate-400">{waitingDays === 0 ? "Diperbarui hari ini" : `${waitingDays} hari belum diperbarui`}</span></div>
    <div className="flex items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500"><Smartphone className="size-5" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold tracking-tight text-brand-950">{ticket.brand} {ticket.model}</p><p className="mt-1 truncate text-xs text-slate-500">{ticket.customerName} · {ticket.keluhan}</p></div>
      <ChevronRight className="size-4 shrink-0 text-slate-300" />
    </div>
    <p className="mt-3 border-t border-slate-100 pt-2.5 font-mono text-[10px] text-slate-400">{ticket.noNota}</p>
  </Link>;
}
