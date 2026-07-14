// Fungsi murni seputar uang — tanpa Dexie/DOM agar bisa diuji dengan `bun test`.
import type {
  CashEntry,
  CashMethod,
  Ticket,
  Unit,
} from "./types";

export const METHOD_LABEL: Record<CashMethod, string> = {
  tunai: "Tunai",
  qris: "QRIS",
  transfer: "Transfer",
};

/** Entri lama (sebelum ada metode pembayaran) dianggap tunai. */
export function methodOf(e: CashEntry): CashMethod {
  return e.method ?? "tunai";
}

export function ticketTotal(t: Ticket): number {
  const jasa = t.biayaJasa || t.estimasi;
  const parts = t.partsUsed.reduce((s, p) => s + p.harga * p.qty, 0);
  return jasa + parts;
}

export function ticketSisa(t: Ticket): number {
  return Math.max(0, ticketTotal(t) - t.dp);
}

export function sumCash(
  entries: CashEntry[],
  method?: CashMethod,
): { masuk: number; keluar: number; net: number } {
  let masuk = 0;
  let keluar = 0;
  for (const e of entries) {
    if (e.voided) continue;
    if (method && methodOf(e) !== method) continue;
    if (e.type === "in") masuk += e.amount;
    else keluar += e.amount;
  }
  return { masuk, keluar, net: masuk - keluar };
}

export interface MonthlyReport {
  servisIn: number;
  partModal: number;
  unitMargin: number;
  unitSoldCount: number;
  returCount: number;
  returTotal: number;
  aksesorisMargin: number;
  operasional: number;
  prive: number;
  laba: number;
  garansiCount: number;
  piutangTotal: number; // outstanding saat ini (bukan per bulan)
  perMethod: Record<CashMethod, { masuk: number; keluar: number }>;
}

function diambilAt(t: Ticket): number | undefined {
  for (let i = t.history.length - 1; i >= 0; i--) {
    if (t.history[i].status === "diambil") return t.history[i].at;
  }
  return undefined;
}

function inMonth(at: number, month: string): boolean {
  const d = new Date(at);
  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return mk === month;
}

/**
 * Laba bulanan dihitung dari jurnal kas (bukan status entitas) agar laporan
 * historis stabil: retur di bulan berbeda muncul sebagai margin negatif di
 * bulan retur, tanpa mengubah laporan bulan penjualan.
 */
export function computeMonthlyReport(
  cash: CashEntry[],
  tickets: Ticket[],
  month: string,
): MonthlyReport {
  const valid = cash.filter((e) => !e.voided && e.dayKey.startsWith(month));

  const servisIn = valid
    .filter((e) => e.type === "in" && e.category === "servis")
    .reduce((s, e) => s + e.amount, 0);

  const sales = valid.filter(
    (e) => e.type === "in" && e.category === "jual_unit",
  );
  const returs = valid.filter(
    (e) => e.type === "out" && e.category === "retur_unit",
  );
  const unitMargin =
    sales.reduce((s, e) => s + e.amount - (e.meta?.modal ?? 0), 0) -
    returs.reduce((s, e) => s + e.amount - (e.meta?.modal ?? 0), 0);

  const aksesorisMargin = valid
    .filter((e) => e.type === "in" && e.category === "jual_aksesoris")
    .reduce((s, e) => s + e.amount - (e.meta?.modal ?? 0), 0);

  const operasional = valid
    .filter((e) => e.type === "out" && e.category === "operasional")
    .reduce((s, e) => s + e.amount, 0);
  const prive = valid
    .filter((e) => e.type === "out" && e.category === "prive")
    .reduce((s, e) => s + e.amount, 0);

  const partModal = tickets
    .filter((t) => {
      const at = diambilAt(t);
      return t.status === "diambil" && at !== undefined && inMonth(at, month);
    })
    .flatMap((t) => t.partsUsed)
    .reduce((s, p) => s + p.modal * p.qty, 0);

  const garansiCount = tickets.filter(
    (t) => t.garansiDari && inMonth(t.createdAt, month),
  ).length;

  const piutangTotal = tickets.reduce((s, t) => s + (t.piutang ?? 0), 0);

  const perMethod = {
    tunai: { masuk: 0, keluar: 0 },
    qris: { masuk: 0, keluar: 0 },
    transfer: { masuk: 0, keluar: 0 },
  };
  for (const e of valid) {
    const m = perMethod[methodOf(e)];
    if (e.type === "in") m.masuk += e.amount;
    else m.keluar += e.amount;
  }

  const laba =
    servisIn - partModal + unitMargin + aksesorisMargin - operasional;

  return {
    servisIn,
    partModal,
    unitMargin,
    unitSoldCount: sales.length,
    returCount: returs.length,
    returTotal: returs.reduce((s, e) => s + e.amount, 0),
    aksesorisMargin,
    operasional,
    prive,
    laba,
    garansiCount,
    piutangTotal,
    perMethod,
  };
}

export function nilaiStok(units: Unit[]): number {
  return units
    .filter((u) => u.status === "stok")
    .reduce((s, u) => s + u.hargaBeli, 0);
}
