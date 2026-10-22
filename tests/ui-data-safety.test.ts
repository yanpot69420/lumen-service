import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { buyUnit } from "@/db/units";
import type { User } from "@/db/types";
import { searchAudit } from "@/lib/audit-search";
import { createBufferedDraft } from "@/lib/buffered-draft";
import { createPendingPhotoBatch } from "@/lib/pending-photo-batch";
import { readUnitPurchaseDraft, writeUnitPurchaseDraft, type UnitPurchaseDraft } from "@/lib/unit-purchase-draft";

const owner: User = { id: "ui-safety-owner", name: "Owner", username: "ui-safety-owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const blob = (text: string) => new Blob([text], { type: "image/jpeg" });
const draft = (brand: string): UnitPurchaseDraft => ({ f: { brand, model: "Phone", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1_000_000, hargaJual: 1_500_000, sellerName: "Penjual", sellerPhone: "", garansiHari: 7 }, method: "transfer", photos: [blob("unit")], ktp: [blob("ktp")] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.add(owner);
});

test("photo compression locks concurrent batches and appends to the current selection only", async () => {
  const photo = deferred<Blob>();
  const original = blob("original");
  const replacement = blob("replacement");
  let selection = [original];
  const states: boolean[] = [];
  let compressed = 0;
  const batch = createPendingPhotoBatch({ compress: async () => { compressed++; return photo.promise; }, append: (added) => { selection = [...selection, ...added]; }, busy: (busy) => states.push(busy), error: () => { throw new Error("Unexpected failure"); } });
  const pending = batch.add([new File(["one"], "one.jpg")]);
  expect(batch.busy).toBe(true);
  await batch.add([new File(["two"], "two.jpg")]);
  expect(compressed).toBe(1);
  // Even an external replacement while compression is pending must be respected.
  selection = [replacement];
  const added = blob("new");
  photo.resolve(added);
  await pending;
  expect(selection).toEqual([replacement, added]);
  expect(selection).not.toContain(original);
  expect(states).toEqual([true, false]);
});

test("a failed photo batch never appends a partially compressed selection and can be retried", async () => {
  let calls = 0;
  const additions: Blob[][] = [];
  const errors: unknown[] = [];
  const states: boolean[] = [];
  const batch = createPendingPhotoBatch({ compress: async () => { if (++calls === 2) throw new Error("Unsupported photo"); return blob("photo"); }, append: (added) => additions.push(added), busy: (busy) => states.push(busy), error: (error) => errors.push(error) });
  await batch.add([new File(["1"], "1.jpg"), new File(["2"], "2.jpg")]);
  expect(additions).toHaveLength(0);
  expect((errors[0] as Error).message).toBe("Unsupported photo");
  expect(batch.busy).toBe(false);
  await batch.add([new File(["3"], "3.jpg")]);
  expect(additions).toHaveLength(1);
  expect(states).toEqual([true, false, true, false]);
});

test("unmounting the photo picker cancels stale compression results", async () => {
  const photo = deferred<Blob>();
  const additions: Blob[][] = [];
  const states: boolean[] = [];
  const batch = createPendingPhotoBatch({ compress: () => photo.promise, append: (added) => additions.push(added), busy: (busy) => states.push(busy), error: () => {} });
  const pending = batch.add([new File(["1"], "1.jpg")]);
  batch.cancel();
  photo.resolve(blob("cancelled"));
  await pending;
  expect(additions).toHaveLength(0);
  expect(states).toEqual([true, false]);
});

test("navigation flush saves the last draft edit immediately and serialized writes keep it last", async () => {
  const first = deferred<void>();
  const written: string[] = [];
  const writer = createBufferedDraft(async (value: string) => { if (value === "old") await first.promise; written.push(value); }, 60_000);
  writer.schedule("old", () => {});
  const savingOld = writer.flush();
  writer.schedule("last keystroke", () => {});
  const leaving = writer.flush();
  first.resolve();
  await Promise.all([savingOld, leaving]);
  expect(written).toEqual(["old", "last keystroke"]);
  await writer.flush();
  expect(written).toHaveLength(2);
});

test("reopening a purchase draft waits for final writes including photos", async () => {
  const original = draft("First");
  const latest = draft("Last keystroke");
  const first = writeUnitPurchaseDraft(original);
  const second = writeUnitPurchaseDraft(latest);
  const loaded = await readUnitPurchaseDraft();
  await Promise.all([first, second]);
  expect(JSON.parse(loaded.raw!.value).f.brand).toBe("Last keystroke");
  expect(loaded.images).toHaveLength(2);
  expect(loaded.images.filter((photo) => photo.refId === "beli-baru")).toHaveLength(1);
});

test("a successful unit purchase cannot resurrect its old buffered draft", async () => {
  const data = draft("Purchased");
  const writer = createBufferedDraft(writeUnitPurchaseDraft, 60_000);
  writer.schedule(data, () => {});
  await writer.flush();
  writer.pause();
  await buyUnit(owner, data.f, data.photos, data.ktp[0], data.method, "ui-safety-unit");
  // Navigation/visibility callbacks cannot write a stale draft after the commit.
  writer.set(draft("stale"));
  await writer.flush();
  const loaded = await readUnitPurchaseDraft();
  expect(loaded.raw?.value).toBe("");
  expect(loaded.images).toHaveLength(0);
  expect(await db.units.count()).toBe(1);
});

test("a failed autosave remains retryable instead of being marked persisted", async () => {
  let attempts = 0;
  const written: string[] = [];
  const writer = createBufferedDraft(async (value: string) => { if (++attempts === 1) throw new Error("Storage full"); written.push(value); }, 60_000);
  writer.set("draft");
  let failed: unknown;
  try { await writer.flush(); } catch (error) { failed = error; }
  expect((failed as Error).message).toBe("Storage full");
  await writer.flush();
  expect(written).toEqual(["draft"]);
});

test("autosave recovery resets failure reporting for the next independent outage", async () => {
  let failing = true;
  let reported = false;
  let notifications = 0;
  let saved = 0;
  const writer = createBufferedDraft(async (_value: string) => { if (failing) throw new Error("Storage unavailable"); }, 60_000, () => { reported = false; saved++; });
  const flush = async () => {
    try { await writer.flush(); } catch {
      if (!reported) notifications++;
      reported = true;
    }
  };
  writer.set("draft");
  await flush();
  await flush();
  expect(notifications).toBe(1);
  expect(saved).toBe(0);
  failing = false;
  await flush();
  expect(reported).toBe(false);
  expect(saved).toBe(1);
  await flush();
  expect(saved).toBe(1); // A skipped duplicate is not another successful write.
  failing = true;
  writer.set("next edit");
  await flush();
  await flush();
  expect(notifications).toBe(2);
  expect(saved).toBe(1);
});

test("audit search includes matches older than the newest 300 and paginates after filtering", async () => {
  await db.audit.bulkAdd(Array.from({ length: 360 }, (_, index) => ({ id: `audit-${index}`, at: 1_000 + index, userId: owner.id, userName: "Owner", action: "update", entity: "part", entityId: `part-${index}`, summary: index < 60 ? `LCD lama ${index}` : `Aktivitas baru ${index}` })));
  const first = await searchAudit({ query: "LCD lama", size: 50 });
  expect(first.entries).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  expect(first.entries[0].id).toBe("audit-59");
  const second = await searchAudit({ query: "LCD lama", size: 50, page: 1 });
  expect(second.entries).toHaveLength(10);
  expect(second.hasMore).toBe(false);
  expect(second.entries.at(-1)?.id).toBe("audit-0");
  expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(60);
});

test("audit date filters use complete WITA days including midnight boundaries", async () => {
  const midnight = Date.parse("2026-10-22T00:00:00+08:00");
  await db.audit.bulkAdd([-1, 0, 86_399_999, 86_400_000].map((offset, index) => ({ id: `day-${index}`, at: midnight + offset, userId: owner.id, userName: "Owner", action: "update", entity: "part", entityId: "p", summary: "Activity" })));
  const result = await searchAudit({ from: "2026-10-22", to: "2026-10-22" });
  expect(result.entries.map((entry) => entry.id)).toEqual(["day-2", "day-1"]);
  expect((await searchAudit({ from: "2026-10-23", to: "2026-10-22" })).entries).toHaveLength(0);
});
