import { beforeEach, expect, test } from "bun:test";
import { liveQuery } from "dexie";
import { db } from "@/db/db";
import { adjustPart, restockPart, savePart } from "@/db/parts";
import { decideCorrection, expectedCashToday, requestCorrection, sumCash } from "@/db/cash";
import { dayKey } from "@/lib/format";
import type { User } from "@/db/types";

const owner: User = { id: "audit-owner", name: "Owner", username: "audit-owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const ho: User = { ...owner, id: "audit-ho", name: "HO", username: "audit-ho", role: "headops" };
const part = { nama: "LCD Samsung", brand: "Samsung", kategori: "sparepart" as const, stok: 5, hargaModal: 70_000, hargaJual: 100_000, minStok: 1 };

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, ho]);
});

test("HO initial stock records total purchase while stock shows cost per piece", async () => {
  const id = await savePart(ho, part);
  expect((await db.parts.get(id))?.hargaModal).toBe(70_000);
  expect((await db.cash.toArray()).map((entry) => entry.amount)).toEqual([350_000]);
  expect(await expectedCashToday()).toBe(-350_000);
});

test("HO restock records total paid and stock shows weighted average, not the latest total", async () => {
  const id = await savePart(ho, part);
  await restockPart(ho, id, 5, 450_000, "tunai");
  expect(await db.parts.get(id)).toMatchObject({ stok: 10, hargaModal: 80_000 });
  expect(sumCash(await db.cash.toArray()).keluar).toBe(800_000);
  expect(await expectedCashToday()).toBe(-800_000);
});

test("physical stock adjustment changes quantities without inventing cash payments", async () => {
  const id = await savePart(ho, part);
  const cashBefore = await db.cash.toArray();
  await adjustPart(ho, id, 8, "Barang lama ditemukan saat hitung fisik", 5);
  expect(await db.parts.get(id)).toMatchObject({ stok: 8, hargaModal: 70_000 });
  expect(await db.cash.toArray()).toEqual(cashBefore);
  expect(await expectedCashToday()).toBe(-350_000);
});

test("editing an item's catalog cost does not rewrite historical purchase payments", async () => {
  const id = await savePart(ho, part);
  await savePart(ho, { ...part, hargaModal: 90_000 }, id);
  expect((await db.parts.get(id))?.hargaModal).toBe(90_000);
  expect(sumCash(await db.cash.toArray()).keluar).toBe(350_000);
});

test("zero-payment restock followed by a physical recount leaves the purchase journal unchanged", async () => {
  const id = await savePart(ho, { ...part, stok: 4 });
  await restockPart(ho, id, 3, 0, "tunai");
  expect((await db.parts.get(id))?.stok).toBe(7);
  await adjustPart(ho, id, 3, "Jumlah akhir seharusnya tiga", 7);
  expect(await db.parts.get(id)).toMatchObject({ stok: 3, hargaModal: 70_000 });
  expect(sumCash(await db.cash.toArray()).keluar).toBe(280_000);
  expect(await db.cash.count()).toBe(1);
});

test("HO correction stays pending until Owner approval, then cash totals agree", async () => {
  await savePart(ho, part);
  const entry = (await db.cash.toArray())[0];
  await requestCorrection(ho, entry.id, { amount: 280_000, note: entry.note, voided: 0 }, "Diskon supplier belum dicatat", entry);
  const correction = (await db.corrections.toArray())[0];
  expect(correction.status).toBe("pending");
  expect((await db.cash.get(entry.id))?.amount).toBe(350_000);
  await decideCorrection(owner, correction.id, true);
  expect((await db.cash.get(entry.id))?.amount).toBe(280_000);
  expect(sumCash(await db.cash.toArray()).keluar).toBe(280_000);
  expect(await expectedCashToday()).toBe(-280_000);
  // Cash corrections currently do not recalculate the item's inventory cost.
  expect((await db.parts.toArray())[0].hargaModal).toBe(70_000);
});

test("cash page's exact live queries refresh both the table and drawer after approval", async () => {
  await savePart(ho, part);
  const entry = (await db.cash.toArray())[0];
  const tableAmounts: number[] = [];
  const drawerAmounts: number[] = [];
  const table = liveQuery(() => db.cash.where("dayKey").equals(dayKey()).reverse().sortBy("at")).subscribe((rows) => tableAmounts.push(rows[0].amount));
  const drawer = liveQuery(() => expectedCashToday()).subscribe((value) => drawerAmounts.push(value));
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 1500;
    while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(condition()).toBe(true);
  };
  try {
    await waitFor(() => tableAmounts.length > 0 && drawerAmounts.length > 0);
    await requestCorrection(ho, entry.id, { amount: 280_000, note: entry.note, voided: 0 }, "Koreksi harga supplier", entry);
    await decideCorrection(owner, (await db.corrections.toArray())[0].id, true);
    await waitFor(() => drawerAmounts.at(-1) === -280_000);
    await waitFor(() => tableAmounts.at(-1) === 280_000);
  } finally {
    table.unsubscribe();
    drawer.unsubscribe();
  }
});
