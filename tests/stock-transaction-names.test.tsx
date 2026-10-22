import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CashDescription } from "@/components/cash-description";
import { db } from "@/db/db";
import { savePart, restockPart, sellPart } from "@/db/parts";
import type { CashEntry, Part, User } from "@/db/types";

const ho: User = { id: "names-ho", name: "HO", username: "names-ho", role: "headops", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const item = { nama: "LCD Samsung", brand: "Samsung", kategori: "sparepart" as const, stok: 5, hargaModal: 70_000, hargaJual: 100_000, minStok: 1 };
const render = (entry: CashEntry, part?: Pick<Part, "id" | "nama">) => renderToStaticMarkup(<CashDescription entry={entry} part={part} />);

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.add(ho);
});

test("renaming an item updates purchase and sale display without rewriting their financial history", async () => {
  const id = await savePart(ho, item);
  await restockPart(ho, id, 2, 140_000, "tunai");
  await sellPart(ho, { partId: id, qty: 1, harga: 100_000, method: "tunai" });
  const before = (await db.parts.get(id))!;
  const journal = await db.cash.toArray();
  await savePart(ho, { ...before, nama: "LCD Samsung A15 OLED" }, id, { displayed: before });
  const renamed = (await db.parts.get(id))!;
  expect(renamed).toMatchObject({ stok: before.stok, hargaModal: before.hargaModal });
  expect(await db.cash.toArray()).toEqual(journal);
  for (const entry of journal) {
    const markup = render(entry, renamed);
    expect(markup).toContain("LCD Samsung A15 OLED");
    expect(markup).toContain(`<summary`);
    expect(markup).toContain(`Keterangan saat dicatat: ${entry.note}`);
  }
});

test("missing items and unrelated references keep the recorded description", async () => {
  const id = await savePart(ho, item);
  const entry = (await db.cash.toArray())[0];
  for (const part of [undefined, { id: "different-item", nama: "Nama yang salah" }]) {
    const markup = render(entry, part);
    expect(markup).toContain(entry.note);
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("Nama yang salah");
  }
  const markup = render({ ...entry, refType: "ticket" }, { id, nama: "Nama yang salah" });
  expect(markup).toContain(entry.note);
  expect(markup).not.toContain("Nama yang salah");
});

test("supplier refunds retain their purpose alongside the current item name", async () => {
  const id = await savePart(ho, item);
  const entry = (await db.cash.toArray())[0];
  const refund: CashEntry = { ...entry, type: "in", category: "lainnya", note: "Pengembalian supplier — LCD Samsung", meta: { purchaseRefundFor: entry.id } };
  const markup = render(refund, { id, nama: "LCD Samsung A15" });
  expect(markup).toContain("Pengembalian supplier · LCD Samsung A15");
  expect(markup).toContain(`Keterangan saat dicatat: ${refund.note}`);
});
