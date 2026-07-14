import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  Smartphone,
  ShoppingCart,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { db } from "@/db/db";
import { sumCash } from "@/db/cash";
import { BackupReminder } from "@/components/backup-reminder";
import { ticketTotal } from "@/db/tickets";
import { useUser } from "@/auth/session";
import { rp, dayKey, daysSince } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Kpi } from "@/components/ui/misc";
import { TicketStatusTag } from "@/components/ui/status-tag";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <>
      <PageHeader title={`Halo, ${user.name.split(" ")[0]} 👋`} />
      <PageBody>
        {/* Aksi cepat */}
        <div className="grid grid-cols-3 gap-2">
          <Link
            to="/app/servis/baru"
            className="flex flex-col items-center gap-1.5 rounded-2xl bg-brand-950 p-4 text-white"
          >
            <Plus className="size-5 text-accent-500" />
            <span className="text-xs font-semibold">Nota Servis</span>
          </Link>
          <Link
            to="/app/stok/beli"
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-4"
          >
            <Smartphone className="size-5 text-brand-600" />
            <span className="text-xs font-semibold">Beli Unit</span>
          </Link>
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
        {stokLama.length > 0 && (
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
    </>
  );
}
