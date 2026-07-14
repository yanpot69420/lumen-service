import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { computeMonthlyReport, nilaiStok, METHOD_LABEL } from "@/db/money";
import { useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { rp, monthKey, monthLabel, daysSince, fmtDate } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Input } from "@/components/ui/field";
import { Kpi, Row } from "@/components/ui/misc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-tag";
import type { CashMethod } from "@/db/types";

const METHODS: CashMethod[] = ["tunai", "qris", "transfer"];

export function LaporanPage() {
  const user = useUser();
  const [month, setMonth] = useState(monthKey());
  const cash = useLiveQuery(
    () =>
      db.cash
        .where("dayKey")
        .between(`${month}-00`, `${month}-99`)
        .toArray(),
    [month],
  );
  const units = useLiveQuery(() => db.units.toArray(), []);
  const tickets = useLiveQuery(() => db.tickets.toArray(), []);

  if (!canSeeMoney(user.role)) {
    return (
      <>
        <PageHeader title="Laporan" />
        <PageBody>
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Laporan laba hanya bisa dilihat Owner / Head Operasional.
          </p>
        </PageBody>
      </>
    );
  }

  const r = computeMonthlyReport(cash ?? [], tickets ?? [], month);
  const inStock = (units ?? []).filter((u) => u.status === "stok");
  const stokValue = nilaiStok(units ?? []);
  const aging = [...inStock].sort((a, b) => a.boughtAt - b.boughtAt);

  return (
    <>
      <PageHeader title="Laporan" />
      <PageBody>
        <Input
          type="month"
          value={month}
          max={monthKey()}
          onChange={(e) => setMonth(e.target.value || monthKey())}
          className="w-full sm:w-48"
        />

        <div className="rounded-2xl bg-brand-950 p-5 text-white">
          <p className="text-xs text-slate-300">
            Laba bersih {monthLabel(month)} (sebelum gaji & bagi hasil)
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{rp(r.laba)}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Rincian</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="Pendapatan servis">{rp(r.servisIn)}</Row>
            <Row label="− Modal sparepart terpakai">− {rp(r.partModal)}</Row>
            <Row label={`Margin jual HP (${r.unitSoldCount} unit)`}>
              {rp(r.unitMargin)}
            </Row>
            {r.returCount > 0 && (
              <Row label={`(termasuk ${r.returCount} retur, refund ${rp(r.returTotal)})`}>
                {""}
              </Row>
            )}
            <Row label="Margin aksesoris/part">{rp(r.aksesorisMargin)}</Row>
            <Row label="− Biaya operasional">− {rp(r.operasional)}</Row>
            <Row label="Laba bersih" strong>
              {rp(r.laba)}
            </Row>
            <div className="my-2 border-t border-slate-100" />
            <Row label="Prive (di luar laba)">{rp(r.prive)}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Uang masuk per metode</CardTitle>
          </CardHeader>
          <CardContent>
            {METHODS.map((m) => (
              <Row key={m} label={METHOD_LABEL[m]}>
                {rp(r.perMethod[m].masuk)}
                <span className="ml-2 text-xs text-slate-400">
                  keluar {rp(r.perMethod[m].keluar)}
                </span>
              </Row>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Kpi
            label="Nilai stok HP saat ini"
            value={rp(stokValue)}
            sub={`${inStock.length} unit — modal parkir`}
          />
          <Kpi
            label="Unit terjual bulan ini"
            value={String(r.unitSoldCount)}
            sub={`margin ${rp(r.unitMargin)}`}
            tone="positive"
          />
          <Kpi
            label="Piutang berjalan"
            value={rp(r.piutangTotal)}
            tone={r.piutangTotal > 0 ? "negative" : "default"}
            sub="belum dibayar pelanggan"
          />
          <Kpi
            label="Klaim garansi bulan ini"
            value={String(r.garansiCount)}
            sub="indikator kualitas pengerjaan"
            tone={r.garansiCount > 0 ? "negative" : "positive"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Umur stok (paling lama di atas)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {aging.length === 0 && (
              <p className="text-sm text-slate-400">Tidak ada unit di stok.</p>
            )}
            {aging.map((u) => {
              const umur = daysSince(u.boughtAt);
              return (
                <div key={u.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {u.kode} · {u.brand} {u.model}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDate(u.boughtAt)}
                  </span>
                  <Tag
                    className={
                      umur > 60
                        ? "bg-red-100 text-red-700"
                        : umur > 30
                          ? "bg-amber-100 text-amber-800"
                          : undefined
                    }
                  >
                    {umur} hari
                  </Tag>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
