import { afterEach, beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { acknowledgeSyncBatch, claimSyncBatch, coalesceChanges } from "@/db/sync";
import { M } from "@/db/sync-mappers";

const part = { id: "receipt-part", nama: "LCD", kategori: "sparepart" as const, stok: 5, hargaModal: 100, hargaJual: 200, minStok: 1 };
beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  db.syncCapture = true;
});
afterEach(() => { db.syncCapture = false; });

async function expectFailure(action: () => Promise<unknown>) {
  let error: unknown;
  try { await action(); } catch (failure) { error = failure; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("antrean tetap disimpan");
}

test("incomplete, unrelated, duplicate and invalid-version receipts cannot erase a queued transaction", async () => {
  await db.transaction("rw", db.parts, async () => {
    await db.parts.bulkAdd([part, { ...part, id: "other-part" }]);
  });
  const { batch } = await claimSyncBatch();
  const receipts = coalesceChanges(batch).map((row) => ({ table: M[row.table].remote, key: row.key, revision: 1 }));
  const queued = await db.outbox.toArray();
  for (const data of [null, {}, [], receipts.slice(0, 1), [receipts[0], receipts[0]],
    [receipts[0], { ...receipts[1], key: "wrong-item" }],
    [receipts[0], { ...receipts[1], table: "cash_entries" }],
    [receipts[0], { ...receipts[1], revision: 2 }],
    [receipts[0], { ...receipts[1], revision: "1" }],
    [receipts[0], { ...receipts[1], revision: 1.5 }]]) {
    await expectFailure(() => acknowledgeSyncBatch(batch, data));
    expect(await db.outbox.toArray()).toEqual(queued);
    expect((await db.parts.get(part.id))?._version).toBeUndefined();
  }
  await acknowledgeSyncBatch(batch, receipts);
  expect(await db.outbox.count()).toBe(0);
  expect((await db.parts.get(part.id))?._version).toBe(1);
});

test("acknowledging an earlier edit preserves newer local values and rebases their expected version", async () => {
  await db.parts.add(part);
  const { batch: first } = await claimSyncBatch();
  await db.parts.update(part.id, { stok: 4 });
  await acknowledgeSyncBatch(first, [{ table: "parts", key: part.id, revision: 1 }]);
  expect(await db.parts.get(part.id)).toMatchObject({ stok: 4, _version: 1 });
  const { batch: second } = await claimSyncBatch();
  expect(second).toHaveLength(1);
  expect(second[0].before?._version).toBe(1);
  expect(second[0].payload?.stok).toBe(4);
  await acknowledgeSyncBatch(second, [{ table: "parts", key: part.id, revision: 2 }]);
  await db.parts.update(part.id, { stok: 3 });
  const queued = await db.outbox.toArray();
  // A second tab received the first RPC response late.
  await acknowledgeSyncBatch(first, [{ table: "parts", key: part.id, revision: 1 }]);
  expect(await db.parts.get(part.id)).toMatchObject({ stok: 3, _version: 2 });
  expect(await db.outbox.toArray()).toEqual(queued);
});

test("partially changed local queue prevents the entire acknowledgment", async () => {
  await db.transaction("rw", db.parts, async () => {
    await db.parts.bulkAdd([part, { ...part, id: "other-part" }]);
  });
  const { batch } = await claimSyncBatch();
  await db.outbox.delete(batch[0].seq!);
  const remaining = await db.outbox.toArray();
  await expectFailure(() => acknowledgeSyncBatch(batch, batch.map((row) => ({ table: "parts", key: row.key, revision: 1 }))));
  expect(await db.outbox.toArray()).toEqual(remaining);
  expect((await db.parts.get("other-part"))?._version).toBeUndefined();
});
