import { useEffect, useState } from "react";
import { db } from "./db";
import { supabase, isCloud } from "./supabase";
import type {
  AuditEntry,
  CashEntry,
  Correction,
  DayClose,
  Part,
  Setting,
  Ticket,
  Unit,
  User,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Konversi nilai ----
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : undefined);
const b2n = (b: unknown): 1 | 0 => (b ? 1 : 0);
const opt = <T>(v: T | null | undefined) => (v === null ? undefined : v);

interface Mapper {
  remote: string; // nama tabel Supabase
  toRemote: (row: any) => any;
  toLocal: (row: any) => any;
}

// ---- Registry pemetaan tiap tabel Dexie → Supabase ----
const M: Record<string, Mapper> = {
  users: {
    remote: "users",
    toRemote: (u: User) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      pin_hash: u.pinHash,
      pin_ver: u.pinVer ?? 2,
      salt: u.salt,
      recovery_hash: u.recoveryHash ?? null,
      recovery_salt: u.recoverySalt ?? null,
      active: !!u.active,
      created_at: iso(u.createdAt),
    }),
    toLocal: (r: any): User => ({
      id: r.id,
      name: r.name,
      username: r.username,
      role: r.role,
      pinHash: r.pin_hash,
      pinVer: r.pin_ver ?? 2,
      salt: r.salt,
      recoveryHash: opt(r.recovery_hash),
      recoverySalt: opt(r.recovery_salt),
      active: b2n(r.active),
      createdAt: ms(r.created_at) ?? Date.now(),
    }),
  },
  settings: {
    remote: "settings",
    toRemote: (s: Setting) => ({ key: s.key, value: s.value }),
    toLocal: (r: any): Setting => ({ key: r.key, value: r.value }),
  },
  tickets: {
    remote: "tickets",
    toRemote: (t: Ticket) => ({
      id: t.id,
      no_nota: t.noNota,
      garansi_dari: t.garansiDari ?? null,
      piutang: t.piutang ?? 0,
      customer_name: t.customerName,
      phone: t.phone,
      brand: t.brand,
      model: t.model,
      keluhan: t.keluhan,
      kelengkapan: t.kelengkapan,
      estimasi: t.estimasi,
      biaya_jasa: t.biayaJasa,
      dp: t.dp,
      status: t.status,
      history: t.history,
      parts_used: t.partsUsed,
      created_by: t.createdBy,
      created_at: iso(t.createdAt),
      updated_at: iso(t.updatedAt),
    }),
    toLocal: (r: any): Ticket => ({
      id: r.id,
      noNota: r.no_nota,
      garansiDari: opt(r.garansi_dari),
      piutang: r.piutang ?? 0,
      customerName: r.customer_name,
      phone: r.phone,
      brand: r.brand,
      model: r.model,
      keluhan: r.keluhan,
      kelengkapan: r.kelengkapan ?? [],
      estimasi: r.estimasi,
      biayaJasa: r.biaya_jasa,
      dp: r.dp,
      status: r.status,
      history: r.history ?? [],
      partsUsed: r.parts_used ?? [],
      createdAt: ms(r.created_at) ?? Date.now(),
      updatedAt: ms(r.updated_at) ?? Date.now(),
      createdBy: r.created_by,
    }),
  },
  units: {
    remote: "units",
    toRemote: (u: Unit) => ({
      id: u.id,
      kode: u.kode,
      brand: u.brand,
      model: u.model,
      varian: u.varian,
      imei: u.imei,
      kondisi: u.kondisi,
      harga_beli: u.hargaBeli,
      harga_jual: u.hargaJual,
      status: u.status,
      seller_name: u.sellerName,
      seller_phone: u.sellerPhone,
      garansi_hari: u.garansiHari,
      bought_at: iso(u.boughtAt),
      sold_at: u.soldAt ? iso(u.soldAt) : null,
      sold_price: u.soldPrice ?? null,
      buyer_name: u.buyerName ?? null,
      buyer_phone: u.buyerPhone ?? null,
      created_by: u.createdBy,
    }),
    toLocal: (r: any): Unit => ({
      id: r.id,
      kode: r.kode,
      brand: r.brand,
      model: r.model,
      varian: r.varian,
      imei: r.imei,
      kondisi: r.kondisi,
      hargaBeli: r.harga_beli,
      hargaJual: r.harga_jual,
      status: r.status,
      sellerName: r.seller_name,
      sellerPhone: r.seller_phone,
      garansiHari: r.garansi_hari,
      boughtAt: ms(r.bought_at) ?? Date.now(),
      soldAt: ms(r.sold_at),
      soldPrice: opt(r.sold_price),
      buyerName: opt(r.buyer_name),
      buyerPhone: opt(r.buyer_phone),
      createdBy: r.created_by,
    }),
  },
  parts: {
    remote: "parts",
    toRemote: (p: Part) => ({
      id: p.id,
      nama: p.nama,
      kategori: p.kategori,
      stok: p.stok,
      harga_modal: p.hargaModal,
      harga_jual: p.hargaJual,
      min_stok: p.minStok,
    }),
    toLocal: (r: any): Part => ({
      id: r.id,
      nama: r.nama,
      kategori: r.kategori,
      stok: r.stok,
      hargaModal: r.harga_modal,
      hargaJual: r.harga_jual,
      minStok: r.min_stok,
    }),
  },
  cash: {
    remote: "cash_entries",
    toRemote: (c: CashEntry) => ({
      id: c.id,
      at: iso(c.at),
      day_key: c.dayKey,
      type: c.type,
      category: c.category,
      method: c.method ?? "tunai",
      amount: c.amount,
      note: c.note,
      ref_type: c.refType ?? null,
      ref_id: c.refId ?? null,
      meta: c.meta ?? null,
      by_user: c.by,
      by_name: c.byName,
      locked: !!c.locked,
      voided: !!c.voided,
    }),
    toLocal: (r: any): CashEntry => ({
      id: r.id,
      at: ms(r.at) ?? Date.now(),
      dayKey: r.day_key,
      type: r.type,
      category: r.category,
      method: r.method ?? "tunai",
      amount: r.amount,
      note: r.note,
      refType: opt(r.ref_type),
      refId: opt(r.ref_id),
      meta: opt(r.meta),
      by: r.by_user,
      byName: r.by_name,
      locked: b2n(r.locked),
      voided: b2n(r.voided),
    }),
  },
  dayCloses: {
    remote: "day_closes",
    toRemote: (d: DayClose) => ({
      day_key: d.dayKey,
      expected: d.expected,
      counted: d.counted,
      selisih: d.selisih,
      note: d.note,
      closed_by: d.closedBy,
      closed_by_name: d.closedByName,
      closed_at: iso(d.closedAt),
    }),
    toLocal: (r: any): DayClose => ({
      dayKey: r.day_key,
      expected: r.expected,
      counted: r.counted,
      selisih: r.selisih,
      note: r.note,
      closedBy: r.closed_by,
      closedByName: r.closed_by_name,
      closedAt: ms(r.closed_at) ?? Date.now(),
    }),
  },
  corrections: {
    remote: "corrections",
    toRemote: (k: Correction) => ({
      id: k.id,
      at: iso(k.at),
      entity: k.entity,
      entity_id: k.entityId,
      reason: k.reason,
      before_data: k.before,
      after_data: k.after,
      requested_by: k.requestedBy,
      requested_by_name: k.requestedByName,
      status: k.status,
      decided_by: k.decidedBy ?? null,
      decided_by_name: k.decidedByName ?? null,
      decided_at: k.decidedAt ? iso(k.decidedAt) : null,
    }),
    toLocal: (r: any): Correction => ({
      id: r.id,
      at: ms(r.at) ?? Date.now(),
      entity: r.entity,
      entityId: r.entity_id,
      reason: r.reason,
      before: r.before_data,
      after: r.after_data,
      requestedBy: r.requested_by,
      requestedByName: r.requested_by_name,
      status: r.status,
      decidedBy: opt(r.decided_by),
      decidedByName: opt(r.decided_by_name),
      decidedAt: ms(r.decided_at),
    }),
  },
  audit: {
    remote: "audit_log",
    toRemote: (a: AuditEntry) => ({
      id: a.id,
      at: iso(a.at),
      user_id: a.userId,
      user_name: a.userName,
      action: a.action,
      entity: a.entity,
      entity_id: a.entityId,
      summary: a.summary,
    }),
    toLocal: (r: any): AuditEntry => ({
      id: r.id,
      at: ms(r.at) ?? Date.now(),
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      summary: r.summary,
    }),
  },
};

// Urutan penting: users & settings lebih dulu (referensi FK), audit terakhir.
const ORDER = [
  "users",
  "settings",
  "parts",
  "units",
  "tickets",
  "cash",
  "dayCloses",
  "corrections",
  "audit",
];

// ---- Capture perubahan lokal → outbox (via Dexie hooks) ----
// Penghitung (bukan boolean) agar aman saat beberapa applyRemote berjalan paralel.
let applyDepth = 0;
const pending = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function capture(table: string, key: unknown) {
  if (applyDepth > 0 || !isCloud || key == null) return;
  if (!pending.has(table)) pending.set(table, new Set());
  pending.get(table)!.add(String(key));
  if (!flushTimer) flushTimer = setTimeout(flushCapture, 0);
}

async function flushCapture() {
  flushTimer = null;
  const entries: { table: string; key: string; at: number }[] = [];
  for (const [table, keys] of pending)
    for (const key of keys) entries.push({ table, key, at: Date.now() });
  pending.clear();
  if (entries.length) {
    await db.outbox.bulkAdd(entries as any);
    scheduleSync();
  }
}

let hooksReady = false;
function registerHooks() {
  if (hooksReady) return;
  hooksReady = true;
  for (const name of ORDER) {
    const t = db.table(name);
    t.hook("creating", (primKey: any, obj: any) => {
      capture(name, primKey ?? obj?.id ?? obj?.key ?? obj?.dayKey);
    });
    t.hook("updating", (_mods: any, primKey: any) => {
      capture(name, primKey);
    });
  }
}

/** Terapkan baris dari cloud ke Dexie tanpa memicu outbox (hindari loop). */
async function applyRemote(fn: () => Promise<void>) {
  applyDepth++;
  try {
    await fn();
  } finally {
    applyDepth--;
  }
}

// ---- Push (drain outbox) ----
async function hasSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

async function pushBatch(): Promise<boolean> {
  if (!supabase) return true;
  const batch = await db.outbox.orderBy("seq").limit(300).toArray();
  if (!batch.length) return true;

  const byTable = new Map<string, Map<string, number[]>>();
  for (const e of batch) {
    if (!byTable.has(e.table)) byTable.set(e.table, new Map());
    const km = byTable.get(e.table)!;
    if (!km.has(e.key)) km.set(e.key, []);
    km.get(e.key)!.push(e.seq!);
  }

  for (const table of ORDER) {
    const km = byTable.get(table);
    if (!km) continue;
    const keys = [...km.keys()];
    const rows = await db.table(table).bulkGet(keys);
    const remoteRows = rows
      .filter((r) => r != null)
      .map((r) => M[table].toRemote(r));
    if (remoteRows.length) {
      const { error } = await supabase.from(M[table].remote).upsert(remoteRows);
      if (error) {
        console.warn("[sync] push gagal", table, error.message);
        return false;
      }
    }
    const seqs = [...km.values()].flat();
    await db.outbox.bulkDelete(seqs);
  }
  return true;
}

// ---- Pull ----
async function pullOne(name: string): Promise<void> {
  if (!supabase) return;
  const reg = M[name];
  let query = supabase.from(reg.remote).select("*");
  if (name === "audit")
    query = query.order("at", { ascending: false }).limit(1000);
  const { data, error } = await query;
  if (error) {
    console.warn("[sync] pull gagal", name, error.message);
    return;
  }
  if (data && data.length) {
    await applyRemote(async () => {
      await db.table(name).bulkPut(data.map(reg.toLocal));
    });
  }
}

// Tarik banyak tabel secara paralel (tabel independen → lebih cepat).
async function pullTables(names: string[]): Promise<void> {
  if (!supabase) return;
  await Promise.all(names.map(pullOne));
}

/** Tarik data inti (users + settings) — dipakai saat login agar cache siap. */
export async function pullCore(): Promise<void> {
  await pullTables(["users", "settings"]);
}

/** Kosongkan seluruh cache lokal + antrean (dipakai saat cloud fresh/di-reset). */
export async function resetLocalCache(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.users,
      db.settings,
      db.tickets,
      db.units,
      db.parts,
      db.cash,
      db.dayCloses,
      db.corrections,
      db.audit,
      db.photos,
      db.outbox,
    ],
    async () => {
      await Promise.all([
        db.users.clear(),
        db.settings.clear(),
        db.tickets.clear(),
        db.units.clear(),
        db.parts.clear(),
        db.cash.clear(),
        db.dayCloses.clear(),
        db.corrections.clear(),
        db.audit.clear(),
        db.photos.clear(),
        db.outbox.clear(),
      ]);
    },
  );
}

// ---- Status ----
export type SyncState = "off" | "idle" | "syncing" | "error" | "offline";
interface Status {
  state: SyncState;
  pending: number;
  lastSync: number;
}
let status: Status = { state: "off", pending: 0, lastSync: 0 };
const listeners = new Set<() => void>();
function setStatus(p: Partial<Status>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): Status {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return status;
}

// ---- Engine ----
let syncing = false;
async function tick() {
  if (syncing || !supabase) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ state: "offline", pending: await db.outbox.count() });
    return;
  }
  if (!(await hasSession())) return;
  syncing = true;
  setStatus({ state: "syncing" });
  try {
    let ok = true;
    let guard = 0;
    while (ok && (await db.outbox.count()) > 0 && guard++ < 30) {
      ok = await pushBatch();
    }
    await pullTables(ORDER);
    setStatus({
      state: ok ? "idle" : "error",
      pending: await db.outbox.count(),
      lastSync: Date.now(),
    });
  } catch (e) {
    console.warn("[sync] tick error", e);
    setStatus({ state: "error", pending: await db.outbox.count() });
  } finally {
    syncing = false;
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(tick, 400);
}

let started = false;
let interval: ReturnType<typeof setInterval> | null = null;
export function startSync() {
  if (started || !isCloud) return;
  registerHooks();
  started = true;
  scheduleSync();
  interval = setInterval(scheduleSync, 30_000);
  window.addEventListener("focus", scheduleSync);
  window.addEventListener("online", scheduleSync);
}
export function stopSync() {
  started = false;
  if (interval) clearInterval(interval);
  window.removeEventListener("focus", scheduleSync);
  window.removeEventListener("online", scheduleSync);
  setStatus({ state: "off" });
}

// Daftarkan hooks sedini mungkin (sebelum tulisan pertama) di mode cloud.
if (isCloud) registerHooks();
