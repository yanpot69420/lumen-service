import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "bun:test";
import Dexie from "dexie";
import { db, LumenDB, markRemoteWrite } from "@/db/db";
import { validateBackup } from "@/lib/backup-schema";
import { exportBackup, restoreBackup } from "@/db/backup";
import { applyRemoteRows, queueLegacyPhotos } from "@/db/sync";

const owner = { id: "owner", name: "Owner", username: "owner", role: "owner" as const, pinHash: "hash", salt: "salt", pinVer: 2 as const, active: 1 as const, createdAt: 1 };
beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
});
test("invalid or incomplete backup cannot modify existing data", async () => {
  await db.users.add(owner);
  expect(() => validateBackup({ app: "lumen-service" })).toThrow();
  await expect(restoreBackup({ app: "lumen-service" })).rejects.toThrow();
  expect(await db.users.get(owner.id)).toEqual(owner);
});
test("restore stores a safety snapshot before replacing validated data", async () => {
  await db.users.add(owner);
  const backup = await exportBackup();
  await db.users.update(owner.id, { name: "Before restore" });
  await restoreBackup(backup);
  expect((await db.users.get(owner.id))?.name).toBe("Owner");
  const snapshot = await db.snapshots.orderBy("at").last();
  expect((snapshot!.state.users[0] as { name: string }).name).toBe("Before restore");
});
test("business write and full outbox payload commit and roll back together", async () => {
  db.syncCapture = true;
  await db.parts.add({ id: "p", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 1, hargaJual: 2, minStok: 1 });
  const queued = await db.outbox.toArray();
  expect(queued).toHaveLength(1);
  expect(queued[0].payload?.stok).toBe(5);
  expect(queued[0].before).toBeNull();
  await expect(Promise.resolve(db.transaction("rw", db.parts, async () => {
    await db.parts.update("p", { stok: 3 });
    throw new Error("Simulated failure");
  }))).rejects.toThrow();
  expect((await db.parts.get("p"))?.stok).toBe(5);
  expect(await db.outbox.count()).toBe(1);
});
test("remote transaction never captures changes; pending local rows survive pulls", async () => {
  db.syncCapture = true;
  await db.parts.add({ id: "p", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 1, hargaJual: 2, minStok: 1 });
  await applyRemoteRows("parts", [{ id: "p", nama: "LCD", kategori: "sparepart", stok: 9, harga_modal: 1, harga_jual: 2, min_stok: 1 }]);
  expect((await db.parts.get("p"))?.stok).toBe(5);
  expect(await db.outbox.count()).toBe(1);
  await db.transaction("rw", db.parts, async () => {
    markRemoteWrite(); await db.parts.update("p", { stok: 7 });
  });
  expect(await db.outbox.count()).toBe(1);
});
test("legacy photos are queued once and draft photos never enter cloud queue", async () => {
  const blob = new Blob(["image"], {type:"image/jpeg"});
  await db.photos.bulkAdd([{ id:"old",refType:"unit",refId:"unit",blob,createdAt:1 },{id:"draft",refType:"draft",refId:"draft",blob,createdAt:1}]);
  await queueLegacyPhotos(); await queueLegacyPhotos();
  expect(await db.outbox.count()).toBe(1);
  expect((await db.outbox.toArray())[0].payload?.blob).toBeInstanceOf(Blob);
});
test("backup preserves photo bytes and ownership when restored", async () => {
  await db.users.add(owner);
  await db.tickets.add({id:"ticket",noNota:"LS-TEST",customerName:"Customer",phone:"",brand:"Test",model:"Phone",keluhan:"LCD",kelengkapan:[],estimasi:0,biayaJasa:0,dp:0,status:"masuk",history:[],partsUsed:[],createdAt:1,updatedAt:1,createdBy:owner.id});
  const blob=new Blob([Uint8Array.of(1,2,3,4)],{type:"image/jpeg"});
  await db.photos.add({id:"photo",refType:"ticket",refId:"ticket",blob,createdAt:1});
  const backup=await exportBackup();
  await db.photos.clear(); await restoreBackup(backup);
  const photo=await db.photos.get("photo");
  expect(photo?.refId).toBe("ticket");
  expect(new Uint8Array(await photo!.blob.arrayBuffer())).toEqual(Uint8Array.of(1,2,3,4));
});
test("upgrading an existing database preserves records, photos and legacy queue", async () => {
  const name=`migration-${crypto.randomUUID()}`; const old=new Dexie(name);
  old.version(3).stores({users:"id, &username, role, active",settings:"key",tickets:"id, &noNota, status, createdAt, phone",photos:"id, [refType+refId]",units:"id, &kode, imei, status, boughtAt, soldAt",parts:"id, nama, kategori",cash:"id, dayKey, at, category, refId",dayCloses:"dayKey, closedAt",corrections:"id, status, at",audit:"id, at, userId, entity",outbox:"++seq, table"});
  await old.table("users").add(owner);
  await old.table("photos").add({id:"photo",refType:"ticket",refId:"ticket",blob:new Blob(["old"],{type:"image/jpeg"}),createdAt:1});
  await old.table("outbox").add({table:"cash",key:"pending",at:1}); old.close();
  const upgraded=new LumenDB(name,true); await upgraded.open();
  expect((await upgraded.users.get(owner.id))?.pinHash).toBe("hash");
  expect(await upgraded.photos.count()).toBe(1);
  expect(await upgraded.outbox.count()).toBe(1);
  await upgraded.delete();
});
