import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { STARTER_PARTS, seedParts } from "@/db/seed-parts";
import { savePart } from "@/db/parts";
import { exportBackup, restoreBackup } from "@/db/backup";
import { validateBackup } from "@/lib/backup-schema";
import { M } from "@/db/sync-mappers";

const owner = { id: "seed-owner", name: "Owner", username: "seed-owner", role: "owner" as const, pinHash: "hash", salt: "salt", active: 1 as const, createdAt: 1 };
beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.add(owner);
});

test("starter catalog is idempotent and creates no cash or inventory value", async () => {
  db.syncCapture = true;
  expect(await seedParts(owner)).toEqual({ added: 30, skipped: 0 });
  expect(await db.parts.count()).toBe(30);
  expect((await db.parts.toArray()).every((p) => p.stok === 0 && p.hargaModal === 0 && p.hargaJual === 0)).toBe(true);
  expect(await db.cash.count()).toBe(0);
  const queue = await db.outbox.toArray();
  expect(queue.filter((row) => row.table === "parts")).toHaveLength(30);
  expect(new Set(queue.map((row) => row.batchId)).size).toBe(1);
  expect(await seedParts(owner)).toEqual({ added: 0, skipped: 30 });
  expect(await db.outbox.count()).toBe(queue.length);
  expect(await db.audit.count()).toBe(1);
});

test("starter catalog preserves edited rows and matches names despite casing and spacing", async () => {
  const byName = { ...STARTER_PARTS[0], id: "existing-part", nama: `  ${STARTER_PARTS[0].nama.toUpperCase().replaceAll(" ", "   ")}  `, stok: 4, hargaModal: 70000, hargaJual: 100000 };
  const byId = { ...STARTER_PARTS[1], nama: "Nama barang sudah disesuaikan toko", stok: 8, hargaModal: 90000, hargaJual: 140000, _version: 7 };
  await db.parts.bulkAdd([byName, byId]);
  expect(await seedParts(owner)).toEqual({ added: 28, skipped: 2 });
  expect(await db.parts.get(byName.id)).toEqual(byName);
  expect(await db.parts.get(byId.id)).toEqual(byId);
  expect(await db.parts.get(STARTER_PARTS[0].id)).toBeUndefined();
});

test("simultaneous seed requests cannot duplicate the catalog", async () => {
  const results = await Promise.all([seedParts(owner), seedParts(owner)]);
  expect(results.reduce((sum, r) => sum + r.added, 0)).toBe(30);
  expect(await db.parts.count()).toBe(30);
  expect(await db.audit.count()).toBe(1);
});

test("seed failure rolls back all new parts and queue entries", async () => {
  db.syncCapture = true;
  const fail = () => { throw new Error("Simulated seed audit failure"); };
  db.audit.hook("creating", fail);
  let error: unknown;
  try { await seedParts(owner); } catch (e) { error = e; }
  finally { db.audit.hook("creating").unsubscribe(fail); }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Simulated");
  expect(await db.parts.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});

test("cashiers and inactive owners cannot load the starter catalog", async () => {
  const cashier = { ...owner, id: "seed-cashier", username: "seed-cashier", role: "kasir" as const };
  await db.users.add(cashier);
  await expect(seedParts(cashier)).rejects.toThrow("akses");
  await db.users.update(owner.id, { active: 0 });
  await expect(seedParts(owner)).rejects.toThrow("akses");
  expect(await db.parts.count()).toBe(0);
});
test("part brand survives save, sync mapping and backup restore; legacy backups remain valid", async () => {
  const id = await savePart(owner, { nama: "LCD Test", brand: "apple", kategori: "sparepart", stok: 0, hargaModal: 100, hargaJual: 200, minStok: 1 });
  const part = (await db.parts.get(id))!;
  expect(part.brand).toBe("Apple");
  expect(M.parts.toLocal(M.parts.toRemote(part)).brand).toBe("Apple");
  const backup = await exportBackup();
  expect(validateBackup(backup).parts[0].brand).toBe("Apple");
  const legacy = structuredClone(backup);
  delete legacy.parts[0].brand;
  expect(validateBackup(legacy).parts[0].brand).toBeUndefined();
  const oldBrand = structuredClone(backup);
  oldBrand.parts[0].brand = "iPhone";
  expect(validateBackup(oldBrand).parts[0].brand).toBe("iPhone");
  const malformed = structuredClone(backup);
  malformed.parts[0].brand = "invalid-brand";
  expect(() => validateBackup(malformed)).toThrow("merek");
  await db.parts.update(id, { brand: "Samsung" });
  await restoreBackup(backup);
  expect((await db.parts.get(id))?.brand).toBe("Apple");
});
