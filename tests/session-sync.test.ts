import { afterEach, beforeEach, expect, test } from "bun:test";
import { db, type OutboxEntry } from "@/db/db";
import { operation } from "@/db/operations";
import { readCorrectionsFor } from "@/db/access";
import { acknowledgeSyncBatch, applyRemoteRows, claimSyncBatch, queueLegacyPhotos } from "@/db/sync";
import { batchActor, planSyncQueue } from "@/db/sync-queue";
import type { Correction, User } from "@/db/types";

const owner: User = { id: "session-owner", name: "Owner", username: "owner", role: "owner", active: 1, pinHash: "", salt: "", createdAt: 1 };
const cashier: User = { ...owner, id: "session-cashier", name: "Kasir", username: "cashier", role: "kasir" };
const technician: User = { ...cashier, id: "session-tech", name: "Teknisi", username: "tech", role: "teknisi" };
const part = { id: "session-part", nama: "LCD", kategori: "sparepart" as const, stok: 5, hargaModal: 123456, hargaJual: 200000, minStok: 1 };
beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, cashier, technician]);
});
afterEach(() => { db.syncCapture = false; });

function row(batch: string, seq: number, actorId: string | undefined, table: string, key: string, payload: Record<string, unknown>): OutboxEntry {
  return { seq, batchId: batch, actorId, table, key, before: null, payload, at: 1 };
}
function correction(id: string, actor: User): Correction {
  const purchase = { partId: part.id, qty: 5, stock: 5, unitCost: 123456, totalCost: 617280, kind: "record" as const };
  return { id, at: 1, entity: "cash", entityId: id, reason: "Koreksi", before: { amount: 100, note: "Awal", voided: 0, purchase }, after: { amount: 90, note: "Baru", voided: 0, purchase }, requestedBy: actor.id, requestedByName: actor.name, status: "approved" };
}

test("staff correction reads cannot expose another account's cached rows or purchase costs and never erase pending work", async () => {
  await db.corrections.bulkAdd([correction("owner-correction", owner), correction("cashier-correction", cashier), correction("tech-correction", technician)]);
  db.syncCapture = true;
  await operation(owner, "stock", async () => { await db.parts.add(part); });
  const queue = await db.outbox.toArray();
  const own = await readCorrectionsFor(cashier);
  expect(own.map((entry) => entry.id)).toEqual(["cashier-correction"]);
  expect(own[0].before.purchase).toBeUndefined(); expect(own[0].after.purchase).toBeUndefined();
  expect((await readCorrectionsFor(technician)).map((entry) => entry.id)).toEqual(["tech-correction"]);
  expect(await readCorrectionsFor(owner)).toHaveLength(3);
  expect(await readCorrectionsFor({ ...cashier, role: "headops" })).toHaveLength(3);
  expect((await db.corrections.get("cashier-correction"))?.before.purchase?.unitCost).toBe(123456);
  expect(await db.outbox.toArray()).toEqual(queue);
  expect((await db.parts.get(part.id))?.hargaModal).toBe(123456);
});

test("new operation journals retain the actual operator instead of a row's original creator", async () => {
  db.syncCapture = true;
  await operation(owner, "stock", async () => { await db.parts.add(part); });
  const rows = await db.outbox.toArray();
  expect(rows[0].actorId).toBe(owner.id);
  expect(batchActor(rows)).toBe(owner.id);
  const legacy = [row("legacy", 1, undefined, "tickets", "t", { createdBy: owner.id }), row("legacy", 2, undefined, "audit", "a", { userId: cashier.id })];
  expect(batchActor(legacy)).toBe(cashier.id);
  expect(batchActor([{ ...legacy[0], actorId: owner.id }, legacy[1]])).toBeUndefined();
});

test("foreign batches stay intact while an independent current-account batch is claimed and acknowledged", async () => {
  db.syncCapture = true;
  await operation(owner, "stock", async () => { await db.parts.add(part); });
  await operation(cashier, "customers", async () => { await db.customers.add({ id: "b-customer", name: "Customer", phone: "", phoneNormalized: "", notes: "", isRegular: false, createdAt: 1, updatedAt: 1, createdBy: cashier.id }); });
  const all = await db.outbox.toArray();
  const claimed = await claimSyncBatch(cashier.id);
  expect(claimed.batch.map((entry) => entry.table)).toEqual(["customers"]);
  expect(claimed.blocked).toBe(1);
  expect(claimed.blockedAccounts[0].userId).toBe(owner.id);
  expect((await db.outbox.get(all[0].seq!))?.inFlight).toBeUndefined();
  await acknowledgeSyncBatch(claimed.batch, [{ table: "customers", key: "b-customer", revision: 1 }]);
  expect(await db.outbox.toArray()).toEqual([all[0]]);
  expect((await claimSyncBatch(owner.id)).batch[0].actorId).toBe(owner.id);
});

test("a later payment or photo cannot overtake another staff member's unsent ticket", () => {
  const entries = [row("a", 1, owner.id, "tickets", "ticket", { customerId: "customer" }), row("b", 2, cashier.id, "cash", "pay", { refType: "ticket", refId: "ticket", dayKey: "2026-10-22" }), row("c", 3, cashier.id, "photos", "photo", { refType: "ticket", refId: "ticket" }), row("d", 4, cashier.id, "customers", "unrelated", {})];
  const plan = planSyncQueue(entries, cashier.id);
  expect(plan.batch.map((entry) => entry.key)).toEqual(["unrelated"]);
  expect(plan.blocked).toBe(3);
  expect(plan.blockedAccounts.some((group) => group.reason === "dependency" && group.userId === cashier.id && group.count === 2)).toBe(true);
});

test("unrelated payments on one day can sync, but a day-close waits for earlier foreign payments", () => {
  const first = row("a", 1, owner.id, "cash", "a", { dayKey: "2026-10-22", refType: "ticket", refId: "a-ticket" });
  const independent = row("b", 2, cashier.id, "cash", "b", { dayKey: "2026-10-22", refType: "ticket", refId: "b-ticket" });
  expect(planSyncQueue([first, independent], cashier.id).batch[0].key).toBe("b");
  const close = row("close", 3, cashier.id, "dayCloses", "2026-10-22", { dayKey: "2026-10-22" });
  expect(planSyncQueue([first, close], cashier.id).batch).toHaveLength(0);
  expect(planSyncQueue([first, close], cashier.id).blockedAccounts.some((group) => group.reason === "dependency")).toBe(true);
  expect(planSyncQueue([{ ...close, actorId: owner.id, seq: 1 }, { ...independent, seq: 2 }], cashier.id).batch).toHaveLength(0);
});

test("unknown legacy actors are preserved rather than silently reassigned to the new login", async () => {
  await db.outbox.add(row("legacy", 1, undefined, "parts", part.id, part));
  const original = await db.outbox.toArray();
  const result = await claimSyncBatch(cashier.id);
  expect(result.batch).toHaveLength(0);
  expect(result.blockedAccounts[0].reason).toBe("unknown");
  expect(await db.outbox.toArray()).toEqual(original);
});

test("a different account may pull fresh rows without overwriting a withheld journal's local data", async () => {
  db.syncCapture = true;
  await operation(owner, "stock", async () => { await db.parts.add(part); });
  const original = await db.outbox.toArray();
  expect((await claimSyncBatch(cashier.id)).batch).toHaveLength(0);
  await applyRemoteRows("parts", [{ id: part.id, nama: "Remote stale", kategori: "sparepart", stok: 9, harga_modal: 0, harga_jual: 2, min_stok: 1, revision: 9 }, { id: "new-remote", nama: "New", kategori: "sparepart", stok: 1, harga_modal: 0, harga_jual: 2, min_stok: 1, revision: 1 }]);
  expect(await db.parts.get(part.id)).toEqual(part);
  expect((await db.parts.get("new-remote"))?.nama).toBe("New");
  expect(await db.outbox.toArray()).toEqual(original);
});

test("a response belonging to an expired session cannot apply any remote rows", async () => {
  let failure: unknown;
  try { await applyRemoteRows("parts", [{ id: part.id, nama: "Remote", kategori: "sparepart", stok: 9, harga_modal: 1, harga_jual: 2, min_stok: 1 }], () => { throw new Error("session changed"); }); }
  catch (error) { failure = error; }
  expect((failure as Error).message).toBe("session changed");
  expect(await db.parts.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});

test("a low-role login cannot migrate private legacy KTP photos from an Owner's cache", async () => {
  await db.photos.bulkAdd([{ id: "private-ktp", refType: "unit-ktp", refId: "unit", blob: new Blob(["private"], { type: "image/jpeg" }), createdAt: 1 }, { id: "public-unit", refType: "unit", refId: "unit", blob: new Blob(["unit"], { type: "image/jpeg" }), createdAt: 1 }]);
  await queueLegacyPhotos(cashier.id);
  expect((await db.outbox.toArray()).map((entry) => entry.key)).toEqual(["public-unit"]);
  expect(await db.photos.count()).toBe(2);
  await queueLegacyPhotos(owner.id);
  expect((await db.outbox.where("table").equals("photos").toArray()).find((entry) => entry.key === "private-ktp")?.actorId).toBe(owner.id);
});

test("authenticated sync keeps pulling through failed pushes and session changes cannot publish stale receipts", async () => {
  // The isolated process keeps its mocked cloud client out of every other test.
  const child = Bun.spawn([process.execPath, "tests/fixtures/session-sync-scenario.ts"], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
  const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`${output}\n${errors}`);
  expect(output).toContain("session-sync scenarios passed");
});
