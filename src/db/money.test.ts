import { describe, expect, test } from "bun:test";
import {
  computeMonthlyReport,
  methodOf,
  nilaiStok,
  sumCash,
  ticketSisa,
  ticketTotal,
} from "./money";
import type { CashEntry, Ticket, Unit } from "./types";

let seq = 0;

function mkTicket(p: Partial<Ticket> = {}): Ticket {
  return {
    id: `t${++seq}`,
    noNota: `LS-${seq}`,
    customerName: "Budi",
    phone: "",
    brand: "X",
    model: "Y",
    keluhan: "rusak",
    kelengkapan: [],
    estimasi: 0,
    biayaJasa: 0,
    dp: 0,
    status: "masuk",
    history: [{ status: "masuk", at: 0, by: "a" }],
    partsUsed: [],
    createdAt: 0,
    updatedAt: 0,
    createdBy: "u",
    ...p,
  };
}

function mkCash(p: Partial<CashEntry> = {}): CashEntry {
  return {
    id: `c${++seq}`,
    at: 0,
    dayKey: "2026-07-10",
    type: "in",
    category: "servis",
    amount: 0,
    note: "",
    by: "u",
    byName: "a",
    locked: 0,
    voided: 0,
    ...p,
  };
}

function mkUnit(p: Partial<Unit> = {}): Unit {
  return {
    id: `u${++seq}`,
    kode: `LU-${seq}`,
    brand: "X",
    model: "Y",
    varian: "",
    imei: "490154203237518",
    kondisi: "",
    hargaBeli: 1_000_000,
    hargaJual: 0,
    status: "stok",
    sellerName: "S",
    sellerPhone: "",
    garansiHari: 7,
    boughtAt: 0,
    createdBy: "u",
    ...p,
  };
}

describe("ticketTotal & ticketSisa", () => {
  test("pakai estimasi bila biaya jasa belum final", () => {
    const t = mkTicket({ estimasi: 450_000 });
    expect(ticketTotal(t)).toBe(450_000);
  });

  test("biaya jasa final mengalahkan estimasi + sparepart ikut", () => {
    const t = mkTicket({
      estimasi: 450_000,
      biayaJasa: 475_000,
      partsUsed: [{ partId: "p", nama: "LCD", qty: 2, harga: 50_000, modal: 30_000 }],
    });
    expect(ticketTotal(t)).toBe(575_000);
  });

  test("sisa tidak pernah negatif (DP > total)", () => {
    const t = mkTicket({ estimasi: 100_000, dp: 150_000 });
    expect(ticketSisa(t)).toBe(0);
  });
});

describe("sumCash & methodOf", () => {
  const entries = [
    mkCash({ type: "in", amount: 100, method: "tunai" }),
    mkCash({ type: "in", amount: 200, method: "qris" }),
    mkCash({ type: "out", amount: 50 }), // legacy tanpa method = tunai
    mkCash({ type: "in", amount: 999, voided: 1 }),
  ];

  test("void tidak dihitung", () => {
    expect(sumCash(entries)).toEqual({ masuk: 300, keluar: 50, net: 250 });
  });

  test("filter per metode; entri lama dianggap tunai", () => {
    expect(methodOf(entries[2])).toBe("tunai");
    expect(sumCash(entries, "tunai")).toEqual({ masuk: 100, keluar: 50, net: 50 });
    expect(sumCash(entries, "qris")).toEqual({ masuk: 200, keluar: 0, net: 200 });
  });
});

describe("computeMonthlyReport", () => {
  const JUL = "2026-07";

  test("laba dasar: servis - modal part + margin unit + margin aksesoris - operasional", () => {
    const cash = [
      mkCash({ category: "servis", amount: 500_000 }),
      mkCash({ category: "jual_unit", amount: 1_500_000, meta: { modal: 1_200_000 } }),
      mkCash({ category: "jual_aksesoris", amount: 60_000, meta: { modal: 40_000 } }),
      mkCash({ type: "out", category: "operasional", amount: 100_000 }),
      mkCash({ type: "out", category: "prive", amount: 50_000 }),
    ];
    const tickets = [
      mkTicket({
        status: "diambil",
        history: [
          { status: "masuk", at: Date.UTC(2026, 6, 1), by: "a" },
          { status: "diambil", at: new Date(2026, 6, 10).getTime(), by: "a" },
        ],
        partsUsed: [{ partId: "p", nama: "LCD", qty: 1, harga: 100_000, modal: 70_000 }],
      }),
    ];
    const r = computeMonthlyReport(cash, tickets, JUL);
    expect(r.servisIn).toBe(500_000);
    expect(r.partModal).toBe(70_000);
    expect(r.unitMargin).toBe(300_000);
    expect(r.aksesorisMargin).toBe(20_000);
    expect(r.operasional).toBe(100_000);
    expect(r.prive).toBe(50_000);
    // 500k - 70k + 300k + 20k - 100k
    expect(r.laba).toBe(650_000);
  });

  test("retur membalik margin: refund penuh = margin nol", () => {
    const cash = [
      mkCash({ category: "jual_unit", amount: 1_500_000, meta: { modal: 1_200_000 } }),
      mkCash({
        type: "out",
        category: "retur_unit",
        amount: 1_500_000,
        meta: { modal: 1_200_000 },
      }),
    ];
    const r = computeMonthlyReport(cash, [], JUL);
    expect(r.unitMargin).toBe(0);
    expect(r.returCount).toBe(1);
  });

  test("retur dengan potongan: laba = harga jual - refund", () => {
    const cash = [
      mkCash({ category: "jual_unit", amount: 1_500_000, meta: { modal: 1_200_000 } }),
      mkCash({
        type: "out",
        category: "retur_unit",
        amount: 1_400_000, // dipotong biaya 100rb
        meta: { modal: 1_200_000 },
      }),
    ];
    const r = computeMonthlyReport(cash, [], JUL);
    expect(r.unitMargin).toBe(100_000);
  });

  test("entri bulan lain & void tidak ikut", () => {
    const cash = [
      mkCash({ category: "servis", amount: 100, dayKey: "2026-06-30" }),
      mkCash({ category: "servis", amount: 999, voided: 1 }),
      mkCash({ category: "servis", amount: 200 }),
    ];
    expect(computeMonthlyReport(cash, [], JUL).servisIn).toBe(200);
  });

  test("split per metode & piutang & garansi", () => {
    const cash = [
      mkCash({ category: "servis", amount: 100, method: "qris" }),
      mkCash({ category: "servis", amount: 50 }),
    ];
    const tickets = [
      mkTicket({ piutang: 75_000 }),
      mkTicket({
        garansiDari: "t1",
        createdAt: new Date(2026, 6, 5).getTime(),
      }),
    ];
    const r = computeMonthlyReport(cash, tickets, JUL);
    expect(r.perMethod.qris.masuk).toBe(100);
    expect(r.perMethod.tunai.masuk).toBe(50);
    expect(r.piutangTotal).toBe(75_000);
    expect(r.garansiCount).toBe(1);
  });
});

describe("nilaiStok", () => {
  test("hanya unit berstatus stok", () => {
    const units = [
      mkUnit({ hargaBeli: 1_000_000 }),
      mkUnit({ hargaBeli: 2_000_000, status: "terjual" }),
      mkUnit({ hargaBeli: 500_000 }),
    ];
    expect(nilaiStok(units)).toBe(1_500_000);
  });
});
