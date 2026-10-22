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
import { BarChart3, CreditCard, Package, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

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
      <PageHeader title="Laporan" subtitle="Lihat hasil usaha, arus pembayaran, dan kesehatan stok." />
      <PageBody>
        <div className="lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="hidden lg:block"><h2 className="text-lg font-semibold text-brand-950">Kinerja {monthLabel(month)}</h2><p className="mt-1 text-sm text-slate-500">Ringkasan usaha untuk periode yang dipilih.</p></div>
        <Input
          type="month"
          aria-label="Bulan laporan"
          value={month}
          max={monthKey()}
          onChange={(e) => setMonth(e.target.value || monthKey())}
          className="w-full sm:w-48 lg:h-11 lg:rounded-xl lg:bg-white"
        />
        </div>

        <div className="rounded-2xl bg-brand-950 p-5 text-white lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-8 lg:rounded-[22px] lg:p-7">
          <div className="min-w-0 lg:flex-1">
          <p className="text-xs text-slate-300">
            <TrendingUp className="mr-2 hidden size-4 text-accent-400 lg:inline-block" /> Laba bersih {monthLabel(month)} (sebelum gaji & bagi hasil)
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums lg:mt-4 lg:break-words lg:text-4xl lg:font-semibold lg:tracking-tight">{rp(r.laba)}</p>
          <p className="mt-3 hidden text-xs leading-relaxed text-white/50 lg:block">Pendapatan dan margin setelah modal sparepart serta biaya operasional.</p>
          </div>
          <div className="hidden min-w-0 border-l border-white/15 pl-8 lg:block"><p className="text-xs text-white/55">Pendapatan servis</p><p className="mt-2 break-words text-xl font-semibold tabular-nums">{rp(r.servisIn)}</p><p className="mt-5 text-xs text-white/55">Margin penjualan HP</p><p className="mt-2 break-words text-xl font-semibold text-accent-400 tabular-nums">{rp(r.unitMargin)}</p></div>
        </div>

        <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        <Card>
          <CardHeader className="lg:border-b lg:border-slate-100 lg:px-6 lg:py-5">
            <CardTitle className="lg:flex lg:items-center lg:gap-2 lg:text-base"><BarChart3 className="hidden size-4 text-brand-600 lg:block" /> Rincian laba</CardTitle>
          </CardHeader>
          <CardContent className="lg:px-6 lg:py-3 lg:[&>div]:py-3 lg:[&>div>:last-child]:tabular-nums">
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
          <CardHeader className="lg:border-b lg:border-slate-100 lg:px-6 lg:py-5">
            <CardTitle className="lg:flex lg:items-center lg:gap-2 lg:text-base"><CreditCard className="hidden size-4 text-brand-600 lg:block" /> Pembayaran per metode</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="lg:hidden">{METHODS.map((m) => (
              <Row key={m} label={METHOD_LABEL[m]}>
                {rp(r.perMethod[m].masuk)}
                <span className="ml-2 text-xs text-slate-400">
                  keluar {rp(r.perMethod[m].keluar)}
                </span>
              </Row>
            ))}</div>
            <div className="hidden lg:block">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><span>Metode</span><span className="text-right">Masuk</span><span className="text-right">Keluar</span></div>
              {METHODS.map((method) => <div key={method} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-t border-slate-100 py-5 text-xs"><span className="font-medium text-slate-600">{METHOD_LABEL[method]}</span><span className="break-words text-right font-semibold tabular-nums text-brand-700">{rp(r.perMethod[method].masuk)}</span><span className="break-words text-right tabular-nums text-slate-500">{rp(r.perMethod[method].keluar)}</span></div>)}
              <p className="rounded-xl bg-brand-50 px-3 py-3 text-xs leading-relaxed text-brand-700">Rincian arus uang masuk dan keluar, termasuk transaksi di luar perhitungan laba.</p>
            </div>
          </CardContent>
        </Card>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
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
          <CardHeader className="lg:border-b lg:border-slate-100 lg:px-6 lg:py-5">
            <div><CardTitle className="lg:flex lg:items-center lg:gap-2 lg:text-base"><Package className="hidden size-4 text-brand-600 lg:block" /> Umur stok <span className="lg:hidden">(paling lama di atas)</span></CardTitle><p className="mt-1 hidden text-xs text-slate-500 lg:block">Prioritaskan unit yang paling lama tersimpan.</p></div><span className="hidden rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 lg:block">{inStock.length} unit</span>
          </CardHeader>
          <CardContent className="space-y-2 lg:space-y-0 lg:p-0">
            <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_140px_100px] gap-6 bg-slate-50/70 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid"><span>Perangkat</span><span>Tanggal beli</span><span className="text-right">Usia stok</span></div>
            {aging.length === 0 && (
              <p className="text-sm text-slate-400 lg:px-6 lg:py-8">Tidak ada unit di stok.</p>
            )}
            {aging.map((u) => {
              const umur = daysSince(u.boughtAt);
              return (
                <Link to={`/app/stok/unit/${u.id}`} key={u.id} className="flex items-center gap-2 text-sm lg:grid lg:grid-cols-[minmax(0,1fr)_140px_100px] lg:gap-6 lg:border-t lg:border-slate-100 lg:px-6 lg:py-4 lg:transition-colors lg:hover:bg-brand-50/50">
                  <span className="min-w-0 flex-1 truncate">
                    {u.kode} · {u.brand} {u.model}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDate(u.boughtAt)}
                  </span>
                  <Tag
                    className={
                      umur > 60
                        ? "justify-self-end bg-red-100 text-red-700"
                        : umur > 30
                          ? "justify-self-end bg-accent-100 text-accent-800"
                          : "justify-self-end"
                    }
                  >
                    {umur} hari
                  </Tag>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
