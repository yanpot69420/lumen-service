import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { exportBackup, restoreBackup } from "@/db/backup";
import { closeCash } from "@/db/cash";
import { db } from "@/db/db";
import { deletePhoto } from "@/db/photos";
import { claimSyncBatch } from "@/db/sync";
import { changeStatus, createTicket, submitServicePrice, usePart } from "@/db/tickets";
import { UNDO_WINDOW_MS, undoServiceChange, withServiceUndo } from "@/db/undo";

const owner = { id: "undo-owner", name: "Owner", username: "undo-owner", role: "owner" as const, pinHash: "hash", salt: "salt", active: 1 as const, createdAt: 1 };
const input = { customerName: "Pelanggan Undo", phone: "081234567890", brand: "Samsung", model: "A15", keluhan: "LCD pecah", kelengkapan: ["SIM Tray"], estimasi: 0, dp: 0 };
const photo = () => new Blob(["kondisi awal"], { type: "image/jpeg" });

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.add(owner);
});
afterEach(() => { db.syncCapture = false; });

// Bun's rejection matcher can stall with Dexie's transaction promise context.
async function expectFailure(action: () => Promise<unknown>, message?: string) {
  let failure: unknown;
  try { await action(); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  if (message) expect((failure as Error).message).toContain(message);
}

async function ticket() {
  return createTicket(owner, input, [photo()]);
}

async function checkedTicket() {
  const t = await ticket();
  await changeStatus(owner, t, "dicek");
  return (await db.tickets.get(t.id))!;
}

async function finishedTicket() {
  const t = await checkedTicket();
  await submitServicePrice(owner, t, 150000, true);
  await changeStatus(owner, (await db.tickets.get(t.id))!, "selesai");
  return (await db.tickets.get(t.id))!;
}

test("undoing intake restores draft and its photo, removes new customer, and keeps original audit", async () => {
  const draft = JSON.stringify({ ...input, device: "Samsung A15" });
  await db.settings.put({ key: "draftServisBaru", value: draft });
  await db.photos.add({ id: "undo-draft-photo", refType: "draft", refId: "servis-baru", blob: photo(), createdAt: 1 });
  const result = await withServiceUndo(owner, "Nota dibuat", () => createTicket(owner, input, [], "tunai", undefined, "servis-baru"));
  expect(result.undo).not.toBeNull();
  expect(result.undo!.expiresAt - Date.now()).toBeLessThanOrEqual(UNDO_WINDOW_MS);
  const originalAudit = await db.audit.toArray();
  expect(originalAudit.length).toBeGreaterThan(0);
  expect((await db.photos.get("undo-draft-photo"))?.refId).toBe(result.value.id);
  await undoServiceChange(owner, result.undo!.id);
  expect(await db.tickets.get(result.value.id)).toBeUndefined();
  expect(await db.customers.count()).toBe(0);
  expect((await db.settings.get("draftServisBaru"))?.value).toBe(draft);
  const restoredPhoto = (await db.photos.get("undo-draft-photo"))!;
  expect(restoredPhoto.refType).toBe("draft");
  expect(restoredPhoto.refId).toBe("servis-baru");
  expect(await restoredPhoto.blob.text()).toBe("kondisi awal");
  for (const entry of originalAudit) expect(await db.audit.get(entry.id)).toEqual(entry);
  expect(await db.audit.count()).toBe(originalAudit.length + 1);
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
});

test("undo coalesces an immediate-work price proposal back to its checked state", async () => {
  const t = await checkedTicket();
  const result = await withServiceUndo(owner, "Harga diajukan", () => submitServicePrice(owner, t, 150000, true));
  expect((await db.tickets.get(t.id))?.status).toBe("dikerjakan");
  await undoServiceChange(owner, result.undo!.id);
  expect(await db.tickets.get(t.id)).toEqual(t);
});

test("undo restores part stock and the complete ticket parts list together", async () => {
  const t = await ticket();
  const part = { id: "undo-part", nama: "LCD Samsung A15", kategori: "sparepart" as const, stok: 5, hargaModal: 70000, hargaJual: 100000, minStok: 1 };
  await db.parts.add(part);
  const result = await withServiceUndo(owner, "Sparepart ditambahkan", () => usePart(owner, t, part.id, 2));
  expect((await db.parts.get(part.id))?.stok).toBe(3);
  expect((await db.tickets.get(t.id))?.partsUsed[0]?.qty).toBe(2);
  await undoServiceChange(owner, result.undo!.id);
  expect(await db.parts.get(part.id)).toEqual(part);
  expect(await db.tickets.get(t.id)).toEqual(t);
});

test("undoing collection restores status and removes its cash settlement atomically", async () => {
  const t = await finishedTicket();
  const result = await withServiceUndo(owner, "Pembayaran disimpan", () => changeStatus(owner, t, "diambil", { bayar: 100000, method: "tunai" }));
  expect((await db.tickets.get(t.id))?.piutang).toBe(50000);
  expect((await db.cash.toArray())[0]?.amount).toBe(100000);
  await undoServiceChange(owner, result.undo!.id);
  expect(await db.tickets.get(t.id)).toEqual(t);
  expect(await db.cash.count()).toBe(0);
});

test("changed rows prevent the entire undo without restoring stock or erasing newer changes", async () => {
  const t = await ticket();
  await db.parts.add({ id: "undo-part", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 70, hargaJual: 100, minStok: 1 });
  const result = await withServiceUndo(owner, "Part dipakai", () => usePart(owner, t, "undo-part", 1));
  await db.tickets.update(t.id, { keluhan: "Keluhan tambahan setelah submit" });
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect((await db.parts.get("undo-part"))?.stok).toBe(4);
  expect((await db.tickets.get(t.id))?.keluhan).toBe("Keluhan tambahan setelah submit");
  expect((await db.tickets.get(t.id))?.partsUsed).toHaveLength(1);
});

test("undo expires at its deadline even when a browser timer has not run", async () => {
  const t = await ticket();
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  const now = spyOn(Date, "now").mockReturnValue(result.undo!.expiresAt + 1);
  try { await expectFailure(() => undoServiceChange(owner, result.undo!.id)); }
  finally { now.mockRestore(); }
  expect((await db.tickets.get(t.id))?.status).toBe("dicek");
});

test("a different active owner cannot undo another staff member's action", async () => {
  const t = await ticket();
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  const other = { ...owner, id: "another-owner", username: "another-owner" };
  await db.users.add(other);
  await expectFailure(() => undoServiceChange(other, result.undo!.id));
  expect((await db.tickets.get(t.id))?.status).toBe("dicek");
});

test("a deactivated actor cannot undo using a stale logged-in user snapshot", async () => {
  const t = await ticket();
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  await db.users.update(owner.id, { active: 0 });
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect((await db.tickets.get(t.id))?.status).toBe("dicek");
});

test("a changed staff role invalidates the old undo authorization", async () => {
  const t = await ticket();
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  await db.users.update(owner.id, { role: "teknisi" });
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect((await db.tickets.get(t.id))?.status).toBe("dicek");
});

test("cash closing prevents undo from removing a settled payment", async () => {
  const t = await finishedTicket();
  const result = await withServiceUndo(owner, "Pembayaran disimpan", () => changeStatus(owner, t, "diambil", { bayar: 150000, method: "tunai" }));
  await closeCash(owner, 150000, "", 150000);
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect((await db.tickets.get(t.id))?.status).toBe("diambil");
  expect((await db.cash.toArray())[0]?.locked).toBe(1);
});

test("a revision-only cloud acknowledgment does not block undo", async () => {
  const t = await ticket();
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  await db.tickets.update(t.id, { _version: 7 });
  await undoServiceChange(owner, result.undo!.id);
  expect((await db.tickets.get(t.id))?.status).toBe("masuk");
});

test("failed actions leave no undo receipt and no partially saved business data", async () => {
  const t = await ticket();
  const before = await db.audit.count();
  await expectFailure(() => withServiceUndo(owner, "Gagal", async () => {
    await changeStatus(owner, t, "dicek");
    throw new Error("Simulasi gagal setelah perubahan");
  }), "Simulasi");
  expect(await db.tickets.get(t.id)).toEqual(t);
  expect(await db.audit.count()).toBe(before);
  expect(await db.undoReceipts.count()).toBe(0);
});

test("a no-op does not offer an undo receipt", async () => {
  const result = await withServiceUndo(owner, "Tidak berubah", async () => 42);
  expect(result.value).toBe(42);
  expect(result.undo).toBeNull();
  expect(await db.undoReceipts.count()).toBe(0);
});

test("undo rollback failure leaves every row in its committed state", async () => {
  const t = await ticket();
  await db.parts.add({ id: "undo-part", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 70, hargaJual: 100, minStok: 1 });
  const result = await withServiceUndo(owner, "Part dipakai", () => usePart(owner, t, "undo-part", 1));
  const committed = await db.tickets.get(t.id);
  const fail = () => { throw new Error("Simulasi gagal saat Undo"); };
  db.tickets.hook("updating", fail);
  try { await expectFailure(() => undoServiceChange(owner, result.undo!.id), "Simulasi"); }
  finally { db.tickets.hook("updating").unsubscribe(fail); }
  expect((await db.parts.get("undo-part"))?.stok).toBe(4);
  expect(await db.tickets.get(t.id)).toEqual(committed);
  await undoServiceChange(owner, result.undo!.id);
  expect((await db.parts.get("undo-part"))?.stok).toBe(5);
});

test("cloud changes wait for the undo deadline and undo keeps only original and compensating audits queued", async () => {
  const t = await ticket();
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  const pending = await db.outbox.toArray();
  expect(pending.some((entry) => entry.table === "tickets")).toBe(true);
  expect(pending.length).toBeGreaterThan(0);
  for (const entry of pending) expect(entry.notBefore).toBeGreaterThanOrEqual(result.undo!.expiresAt);
  const auditIds = pending.filter((entry) => entry.table === "audit").map((entry) => entry.key);
  expect(auditIds.length).toBeGreaterThan(0);
  await undoServiceChange(owner, result.undo!.id);
  expect((await db.tickets.get(t.id))?.status).toBe("masuk");
  const after = await db.outbox.toArray();
  expect(after.every((entry) => entry.table === "audit")).toBe(true);
  for (const id of auditIds) {
    expect(after.some((entry) => entry.key === id)).toBe(true);
    expect(await db.audit.get(id)).toBeDefined();
  }
  expect(after.length).toBe(auditIds.length + 1);
  const nextClaim = await claimSyncBatch();
  expect(nextClaim.batch.length).toBeGreaterThan(0);
  expect(nextClaim.batch.every((entry) => entry.table === "audit")).toBe(true);
});

test("undo restores a deleted photo at the latest acknowledged cloud revision", async () => {
  const t = await ticket();
  const original = (await db.photos.where({ refType: "ticket", refId: t.id }).first())!;
  await db.photos.update(original.id, { _version: 2 });
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Foto dihapus", () => deletePhoto(owner, original.id));
  const deletion = (await db.outbox.where("table").equals("photos").first())!;
  expect(deletion.payload).toBeNull();
  // An earlier in-flight edit can be acknowledged while this deletion is held.
  await db.outbox.update(deletion.seq!, { before: { ...deletion.before, _version: 9 } });
  await undoServiceChange(owner, result.undo!.id);
  const restored = (await db.photos.get(original.id))!;
  expect(restored._version).toBe(9);
  expect(await restored.blob.text()).toBe("kondisi awal");
  expect(restored.refId).toBe(t.id);
  expect((await db.outbox.toArray()).every((entry) => entry.table === "audit")).toBe(true);
});

test("sync cannot claim an undoable batch until its complete eight-second window ends", async () => {
  const t = await ticket();
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  const pending = await db.outbox.toArray();
  const waiting = await claimSyncBatch();
  expect(waiting.batch).toEqual([]);
  expect(waiting.retryAt).toBe(result.undo!.expiresAt);
  expect((await db.outbox.toArray()).every((entry) => !entry.inFlight)).toBe(true);
  const now = spyOn(Date, "now").mockReturnValue(result.undo!.expiresAt);
  try {
    const due = await claimSyncBatch();
    expect(due.batch.map((entry) => entry.seq)).toEqual(pending.map((entry) => entry.seq));
    expect((await db.outbox.toArray()).every((entry) => entry.inFlight)).toBe(true);
  } finally { now.mockRestore(); }
});

test("a claimed cloud batch cannot be undone from a stale snackbar", async () => {
  const t = await ticket();
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Pengecekan dimulai", () => changeStatus(owner, t, "dicek"));
  // Exercise the independent claim guard while the receipt is still unexpired.
  await db.outbox.toCollection().modify({ notBefore: 0 });
  const sending = await claimSyncBatch();
  expect(sending.batch.some((entry) => entry.table === "tickets")).toBe(true);
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect((await db.tickets.get(t.id))?.status).toBe("dicek");
  expect((await db.outbox.toArray()).some((entry) => entry.table === "tickets" && entry.inFlight)).toBe(true);
});

test("a new draft photo prevents undoing a cleared draft and overwriting the new intake", async () => {
  const draft = JSON.stringify({ ...input, device: "Samsung A15" });
  await db.settings.put({ key: "draftServisBaru", value: draft });
  await db.photos.add({ id: "old-draft-photo", refType: "draft", refId: "servis-baru", blob: photo(), createdAt: 1 });
  const result = await withServiceUndo(owner, "Draft dibuang", async () => {
    await db.settings.put({ key: "draftServisBaru", value: "" });
    await db.photos.delete("old-draft-photo");
  });
  await db.photos.add({ id: "new-draft-photo", refType: "draft", refId: "servis-baru", blob: new Blob(["foto pelanggan berikutnya"], { type: "image/jpeg" }), createdAt: 2 });
  await expectFailure(() => undoServiceChange(owner, result.undo!.id), "Foto draft sudah berubah");
  expect((await db.settings.get("draftServisBaru"))?.value).toBe("");
  expect(await db.photos.get("old-draft-photo")).toBeUndefined();
  expect(await (await db.photos.get("new-draft-photo"))!.blob.text()).toBe("foto pelanggan berikutnya");
  expect(await db.photos.count()).toBe(1);
});

test("undo cannot remove a newly created customer after another ticket uses that profile", async () => {
  const result = await withServiceUndo(owner, "Nota dibuat", () => createTicket(owner, input, [photo()]));
  const second = await createTicket(owner, { ...input, customerId: result.value.customerId, model: "A25" }, [photo()]);
  expect(second.customerId).toBe(result.value.customerId);
  await expectFailure(() => undoServiceChange(owner, result.undo!.id), "Pelanggan sudah dipakai nota lain");
  expect(await db.tickets.count()).toBe(2);
  expect(await db.customers.get(result.value.customerId!)).toBeDefined();
  expect(await db.tickets.get(result.value.id)).toBeDefined();
  expect(await db.tickets.get(second.id)).toBeDefined();
  expect(await db.photos.count()).toBe(2);
});

test("restoring a backup invalidates old undo receipts and protects the restored state", async () => {
  const backup = await exportBackup();
  const result = await withServiceUndo(owner, "Nota dibuat", () => createTicket(owner, input, [photo()]));
  expect(await db.undoReceipts.count()).toBe(1);
  await restoreBackup(backup);
  expect(await db.undoReceipts.count()).toBe(0);
  await expectFailure(() => undoServiceChange(owner, result.undo!.id));
  expect(await db.tickets.count()).toBe(0);
  expect(await db.customers.count()).toBe(0);
  expect(await db.photos.count()).toBe(0);
  expect(await db.users.get(owner.id)).toEqual(owner);
});

test("a changed-view guard inside undo preserves the committed action and allows a later safe retry", async () => {
  const t = await ticket();
  await db.parts.add({ id: "guard-part", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 70, hargaJual: 100, minStok: 1 });
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Part dipakai", () => usePart(owner, t, "guard-part", 1));
  const committed = {
    ticket: await db.tickets.get(t.id),
    part: await db.parts.get("guard-part"),
    outbox: await db.outbox.toArray(),
    receipt: await db.undoReceipts.get(result.undo!.id),
    auditCount: await db.audit.count(),
  };
  let guardCalls = 0;
  await expectFailure(() => undoServiceChange(owner, result.undo!.id, () => {
    guardCalls++;
    throw new Error("Tampilan sudah berubah selama menunggu Undo");
  }), "Tampilan sudah berubah");
  expect(guardCalls).toBe(1);
  expect(await db.tickets.get(t.id)).toEqual(committed.ticket);
  expect(await db.parts.get("guard-part")).toEqual(committed.part);
  expect(await db.outbox.toArray()).toEqual(committed.outbox);
  expect(await db.undoReceipts.get(result.undo!.id)).toEqual(committed.receipt);
  expect(await db.audit.count()).toBe(committed.auditCount);
  await undoServiceChange(owner, result.undo!.id);
  expect(await db.tickets.get(t.id)).toEqual(t);
  expect((await db.parts.get("guard-part"))?.stok).toBe(5);
  expect(await db.undoReceipts.get(result.undo!.id)).toBeUndefined();
  expect((await db.outbox.toArray()).every((entry) => entry.table === "audit")).toBe(true);
});
