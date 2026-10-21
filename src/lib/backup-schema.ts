import type { AuditEntry, CashEntry, Correction, Customer, DayClose, Part, Setting, Ticket, Unit, User } from "@/db/types";
import { normalizePartBrand } from "./part-brands";
import { waPhone } from "./wa";

export interface BackupPhoto { id: string; refType: "ticket" | "unit" | "unit-ktp" | "draft"; refId: string; createdAt: number; dataUrl: string; }
export interface BackupPayload {
  app: "lumen-service"; version: 1 | 2 | 3 | 4; exportedAt: string; source?: "local" | "cloud";
  users: User[]; settings: Setting[]; customers: Customer[]; tickets: Ticket[]; units: Unit[]; parts: Part[];
  cash: CashEntry[]; dayCloses: DayClose[]; corrections: Correction[]; audit: AuditEntry[]; photos: BackupPhoto[];
}
export const BACKUP_TABLES = ["users", "settings", "customers", "tickets", "units", "parts", "cash", "dayCloses", "corrections", "audit", "photos"] as const;
const fail = (message: string): never => { throw new Error(`Backup tidak valid: ${message}`); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string";
const filled = (v: unknown) => text(v) && (v as string).trim().length > 0;
const number = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const choice = (v: unknown, values: unknown[]) => values.includes(v);
const purchaseSnapshot = (v: unknown) => object(v) && ["qty", "stockBefore", "costBefore", "stockAfter", "costAfter", "totalCost", "partVersion"].every((key) => number(v[key])) && (v.qty as number) > 0 && v.stockAfter === (v.stockBefore as number) + (v.qty as number);
const purchaseDetail = (v: unknown) => object(v) && filled(v.partId) && ["qty", "stock", "unitCost", "totalCost"].every((key) => number(v[key])) && (v.qty as number) > 0 && choice(v.kind, ["record", "refund"]);

/** Validate every table before opening a destructive transaction. */
export function validateBackup(raw: unknown): BackupPayload {
  if (!object(raw) || raw.app !== "lumen-service") fail("bukan file D&R GadgetCare");
  const data = { ...(raw as Record<string, unknown>) };
  if (data.version === 1 && data.photos === undefined) data.photos = [];
  if (choice(data.version, [1, 2, 3]) && data.customers === undefined) data.customers = [];
  if (!choice(data.version, [1, 2, 3, 4]) || !text(data.exportedAt) || !Number.isFinite(Date.parse(data.exportedAt as string))) fail("versi atau tanggal tidak didukung");
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(data[table])) fail(`tabel ${table} hilang`);
    const seen = new Set();
    for (const row of data[table] as unknown[]) {
      if (!object(row)) fail(`baris ${table} rusak`);
      const r = row as Record<string, unknown>;
      const key = r[table === "settings" ? "key" : table === "dayCloses" ? "dayKey" : "id"];
      if (!filled(key) || seen.has(key)) fail(`identitas ${table} kosong/duplikat`);
      seen.add(key);
      if (Object.keys(r).some((k) => ["__proto__", "constructor", "prototype"].includes(k))) fail("properti terlarang");
      const strings: Record<string, string[]> = {
        users: ["name"], settings: ["value"], customers: ["name", "phone", "phoneNormalized", "notes", "createdBy"], tickets: ["noNota", "customerName", "phone", "brand", "model", "keluhan", "createdBy"],
        units: ["kode", "brand", "model", "imei", "sellerName", "createdBy"], parts: ["nama"], cash: ["dayKey", "note", "by", "byName"],
        dayCloses: ["note", "closedBy", "closedByName"], corrections: ["entityId", "reason", "requestedBy", "requestedByName"], audit: ["userId", "userName", "action", "entity", "entityId", "summary"], photos: ["refId", "dataUrl"],
      };
      const numbers: Record<string, string[]> = {
        users: ["createdAt"], settings: [], customers: ["createdAt", "updatedAt"], tickets: ["estimasi", "biayaJasa", "dp", "createdAt", "updatedAt"], units: ["hargaBeli", "hargaJual", "garansiHari", "boughtAt"],
        parts: ["stok", "hargaModal", "hargaJual", "minStok"], cash: ["amount", "at"], dayCloses: ["counted", "closedAt"], corrections: ["at"], audit: ["at"], photos: ["createdAt"],
      };
      if (!strings[table].every((k) => text(r[k])) || !numbers[table].every((k) => number(r[k]))) fail(`kolom ${table} rusak`);
      if (table === "users" && (!choice(r.role, ["owner", "headops", "kasir", "teknisi"]) || !choice(r.active, [0, 1]) || !choice(r.pinVer, [undefined, 1, 2]) || (r.username !== undefined && !filled(r.username)))) fail("peran atau kredensial pengguna rusak");
      if (table === "customers" && (
        !filled(r.name) || (r.name as string).length > 120 || typeof r.isRegular !== "boolean" || (r.notes as string).length > 2000 ||
        (r.phone as string).length > 40 || !/^\+?[\d\s()-]*$/.test(r.phone as string) ||
        waPhone(r.phone as string) !== r.phoneNormalized || (r.phone !== "" && !/^\d{8,15}$/.test(r.phoneNormalized as string))
      )) fail("profil pelanggan rusak");
      if (table === "tickets") {
        if (!choice(r.status, ["masuk", "dicek", "konfirmasi", "dikerjakan", "selesai", "diambil", "batal"]) || !Array.isArray(r.history) || !Array.isArray(r.partsUsed) || !Array.isArray(r.kelengkapan)) fail("tiket rusak");
        if (!(r.history as unknown[]).every((h) => object(h) && number(h.at) && text(h.by) && choice(h.status, ["masuk", "dicek", "konfirmasi", "dikerjakan", "selesai", "diambil", "batal"]))) fail("riwayat tiket rusak");
        if (!(r.partsUsed as unknown[]).every((p) => object(p) && filled(p.partId) && text(p.nama) && number(p.qty) && (p.qty as number) > 0 && number(p.harga) && number(p.modal))) fail("part tiket rusak");
        if (!(r.kelengkapan as unknown[]).every(text) || (r.piutang !== undefined && !number(r.piutang)) || !choice(r.hargaFinal, [undefined, true, false]) || (r.garansiDari !== undefined && !filled(r.garansiDari))) fail("rincian tiket rusak");
      }
      if (table === "units" && (!choice(r.status, ["stok", "terjual"]) || (r.soldAt !== undefined && !number(r.soldAt)) || (r.soldPrice !== undefined && !number(r.soldPrice)))) fail("status atau penjualan unit rusak");
      if (table === "parts" && !choice(r.kategori, ["sparepart", "aksesoris"])) fail("kategori part rusak");
      if (table === "parts" && r.brand !== undefined && (!text(r.brand) || !normalizePartBrand(r.brand as string))) fail("merek part rusak");
      if (table === "cash" && (!choice(r.type, ["in", "out"]) || !choice(r.category, ["servis", "jual_unit", "retur_unit", "jual_aksesoris", "beli_unit", "restok_part", "operasional", "prive", "modal_masuk", "lainnya"]) || !choice(r.method, [undefined, "tunai", "qris", "transfer"]) || !choice(r.locked, [0, 1]) || !choice(r.voided, [0, 1]))) fail("jurnal kas rusak");
      if (table === "cash" && r.meta !== undefined && (!object(r.meta) || (r.meta.modal !== undefined && !number(r.meta.modal)) || (r.meta.qty !== undefined && (!number(r.meta.qty) || (r.meta.qty as number) === 0)) || !choice(r.meta.paymentKind, [undefined, "dp", "settlement", "piutang", "refund"]))) fail("snapshot jurnal kas rusak");
      if (table === "cash" && object(r.meta) && ((r.meta.purchase !== undefined && !purchaseSnapshot(r.meta.purchase)) || (r.meta.purchaseRefundFor !== undefined && !filled(r.meta.purchaseRefundFor)))) fail("snapshot pembelian rusak");
      if (table === "dayCloses" && (![r.expected, r.selisih].every((v) => typeof v === "number" && Number.isSafeInteger(v)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.dayKey)))) fail("tutup kas rusak");
      if (table === "corrections" && (!choice(r.status, ["pending", "approved", "rejected"]) || ![r.before, r.after].every((v) => object(v) && number(v.amount) && text(v.note) && choice(v.voided, [0, 1])))) fail("koreksi rusak");
      if (table === "corrections" && [r.before, r.after].some((v) => object(v) && v.purchase !== undefined && !purchaseDetail(v.purchase))) fail("rincian koreksi pembelian rusak");
      if (table === "photos" && (!choice(r.refType, ["ticket", "unit", "unit-ktp", "draft"]) || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(r.dataUrl)))) fail("foto rusak");
    }
  }
  const result = data as unknown as BackupPayload;
  if (!result.users.some((u) => u.role === "owner" && u.active)) fail("akun Owner aktif hilang");
  const users = new Set(result.users.map((r) => r.id));
  if ([...result.customers, ...result.tickets, ...result.units].some((r) => !users.has(r.createdBy)) || result.cash.some((r) => !users.has(r.by)) || result.audit.some((r) => !users.has(r.userId)) || result.dayCloses.some((r) => !users.has(r.closedBy)) || result.corrections.some((r) => !users.has(r.requestedBy))) fail("referensi pengguna hilang");
  const customers = new Set(result.customers.map((r) => r.id));
  if (result.tickets.some((r) => r.customerId !== undefined && (!filled(r.customerId) || !customers.has(r.customerId)))) fail("referensi pelanggan hilang");
  const identities = result.customers.filter((c) => c.phoneNormalized).map((c) => `${c.phoneNormalized}|${c.name.trim().replace(/\s+/g, " ").toLowerCase()}`);
  if (new Set(identities).size !== identities.length) fail("pelanggan duplikat");
  const tickets = new Set(result.tickets.map((r) => r.id));
  const units = new Set(result.units.map((r) => r.id));
  const parts = new Set(result.parts.map((r) => r.id));
  const cash = new Map(result.cash.map((r) => [r.id, r]));
  if (result.cash.some((entry) => {
    if (entry.meta?.purchase && (entry.type !== "out" || entry.category !== "restok_part" || entry.refType !== "part" || !parts.has(entry.refId ?? ""))) return true;
    if (!entry.meta?.purchaseRefundFor) return false;
    const source = cash.get(entry.meta.purchaseRefundFor);
    return entry.type !== "in" || entry.category !== "restok_part" || entry.refType !== "part" || !source?.meta?.purchase || source.refId !== entry.refId;
  })) fail("referensi pembelian atau pengembalian supplier hilang");
  if (result.corrections.some((correction) => {
    const before = correction.before.purchase; const after = correction.after.purchase;
    return (before || after) && (!before || !after || before.partId !== after.partId || before.kind !== after.kind || !parts.has(after.partId) || cash.get(correction.entityId)?.refId !== after.partId);
  })) fail("referensi koreksi pembelian hilang");
  if (result.tickets.some((r) => r.garansiDari !== undefined && (!tickets.has(r.garansiDari) || r.garansiDari === r.id))) fail("referensi garansi hilang atau tidak valid");
  const stockImeis = result.units.filter((r) => r.status === "stok").map((r) => r.imei);
  if (new Set(stockImeis).size !== stockImeis.length) fail("IMEI ganda pada stok aktif");
  if (result.photos.some((p) => p.refType === "ticket" ? !tickets.has(p.refId) : p.refType !== "draft" && !units.has(p.refId))) fail("referensi foto hilang");
  const notas = result.tickets.map((r) => r.noNota);
  const codes = result.units.map((r) => r.kode);
  if (new Set(notas).size !== notas.length || new Set(codes).size !== codes.length) fail("nomor nota duplikat");
  return result;
}
