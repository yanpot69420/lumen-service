import { logAudit } from "./audit";
import { normalizePartBrand } from "@/lib/part-brands";
import { addCash } from "./cash";
import { db, uid } from "./db";
import { amount, operation } from "./operations";
import type { CashMethod, Part, User } from "./types";

export type PartCatalogSnapshot = Pick<Part, "nama" | "brand" | "kategori" | "hargaJual" | "minStok">;
export interface SavePartOptions { displayed?: PartCatalogSnapshot; initialPaymentMethod?: CashMethod; }
export async function savePart(user: User, data: Omit<Part, "id">, id?: string, options: SavePartOptions = {}) {
  return operation(user, "stock", async (actor) => {
    for (const n of [data.stok, data.hargaModal, data.hargaJual, data.minStok]) amount(n);
    if (!data.nama.trim()) throw new Error("Nama item wajib diisi");
    const key = id ?? uid();
    const current = id ? await db.parts.get(id) : undefined;
    if (id && !current) throw new Error("Item tidak ditemukan");
    if (current && (!options.displayed || (["nama", "brand", "kategori", "hargaJual", "minStok"] as const).some((field) => current[field] !== options.displayed![field]))) throw new Error("Data item sudah berubah. Buka kembali form dan periksa nama serta harga terbaru.");
    const method = options.initialPaymentMethod ?? "tunai";
    if (!["tunai", "qris", "transfer"].includes(method)) throw new Error("Metode pembayaran tidak valid");
    const brand = data.brand === undefined ? current?.brand : normalizePartBrand(data.brand);
    if (data.brand !== undefined && !brand) throw new Error("Pilih merek HP yang valid");
    await db.parts.put({ ...data, brand, nama: data.nama.trim(), id: key, ...(current ? { stok: current.stok, hargaModal: current.hargaModal, _version: current._version } : {}) });
    if (!current && data.stok * data.hargaModal > 0) await addCash(actor, { type: "out", category: "restok_part", amount: data.stok * data.hargaModal, method, note: `Stok awal ${data.nama}`, refType: "part", refId: key, meta: { purchase: { qty: data.stok, stockBefore: 0, costBefore: 0, stockAfter: data.stok, costAfter: data.hargaModal, totalCost: data.stok * data.hargaModal, partVersion: 1 } } });
    await logAudit(actor, current ? "ubah" : "buat", "part", key, `${current ? "Ubah" : "Stok awal"} ${data.nama}`);
    return key;
  });
}
export async function sellPart(user: User, sale: { partId: string; qty: number; harga: number; method: CashMethod; }) {
  return operation(user, "sell", async (actor) => {
    amount(sale.qty, "Jumlah", true); amount(sale.harga, "Harga", true);
    const part = await db.parts.get(sale.partId);
    if (!part || part.stok < sale.qty) throw new Error("Stok tidak cukup");
    await db.parts.update(part.id, { stok: part.stok - sale.qty });
    await addCash(actor, { type: "in", category: "jual_aksesoris", amount: sale.harga * sale.qty, method: sale.method, note: `Jual ${sale.qty}× ${part.nama}`, refType: "part", refId: part.id, meta: { modal: part.hargaModal * sale.qty, qty: sale.qty } });
    await logAudit(actor, "jual", "part", part.id, `Jual ${sale.qty}× ${part.nama}`);
  });
}
export async function restockPart(user: User, id: string, qty: number, cost: number, method: CashMethod) {
  return operation(user, "stock", async (actor) => {
    amount(qty, "Jumlah", true); amount(cost);
    const part = await db.parts.get(id);
    if (!part) throw new Error("Item tidak ditemukan");
    const stok = part.stok + qty;
    const hargaModal = cost ? Math.round((part.hargaModal * part.stok + cost) / stok) : part.hargaModal;
    await db.parts.update(id, { stok, hargaModal });
    if (cost) await addCash(actor, { type: "out", category: "restok_part", amount: cost, method, note: `Restok ${qty}× ${part.nama}`, refType: "part", refId: id, meta: { purchase: { qty, stockBefore: part.stok, costBefore: part.hargaModal, stockAfter: stok, costAfter: hargaModal, totalCost: cost, partVersion: (part._version ?? 0) + 1 } } });
    await logAudit(actor, "restok", "part", id, `Restok ${part.nama}: ${part.stok} → ${stok}`);
  });
}
export async function adjustPart(user: User, id: string, stock: number, reason: string, displayedStock?: number) {
  return operation(user, "stock", async (actor) => {
    amount(stock, "Stok"); if (!reason.trim()) throw new Error("Alasan wajib diisi");
    const part = await db.parts.get(id); if (!part) throw new Error("Item tidak ditemukan");
    if (displayedStock !== undefined && part.stok !== displayedStock) throw new Error("Stok sudah berubah. Buka kembali penyesuaian dan periksa hitungan terbaru.");
    await db.parts.update(id, { stok: stock });
    await logAudit(actor, "opname", "part", id, `${part.nama}: ${part.stok} → ${stock}. ${reason}`);
  });
}
