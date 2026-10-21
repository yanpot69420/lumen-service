import { logAudit } from "./audit";
import { normalizePartBrand } from "@/lib/part-brands";
import { addCash } from "./cash";
import { db, uid } from "./db";
import { amount, operation } from "./operations";
import type { CashMethod, Part, User } from "./types";

export async function savePart(user: User, data: Omit<Part, "id">, id?: string) {
  return operation(user, "stock", async (actor) => {
    for (const n of [data.stok, data.hargaModal, data.hargaJual, data.minStok]) amount(n);
    if (!data.nama.trim()) throw new Error("Nama item wajib diisi");
    const key = id ?? uid();
    const current = id ? await db.parts.get(id) : undefined;
    if (id && !current) throw new Error("Item tidak ditemukan");
    const brand = data.brand === undefined ? current?.brand : normalizePartBrand(data.brand);
    if (data.brand !== undefined && !brand) throw new Error("Pilih merek HP yang valid");
    await db.parts.put({ ...data, brand, nama: data.nama.trim(), id: key, ...(current ? { stok: current.stok, _version: current._version } : {}) });
    if (!current && data.stok * data.hargaModal > 0) await addCash(actor, { type: "out", category: "restok_part", amount: data.stok * data.hargaModal, note: `Stok awal ${data.nama}`, refType: "part", refId: key });
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
    await db.parts.update(id, { stok, hargaModal: cost ? Math.round((part.hargaModal * part.stok + cost) / stok) : part.hargaModal });
    if (cost) await addCash(actor, { type: "out", category: "restok_part", amount: cost, method, note: `Restok ${qty}× ${part.nama}`, refType: "part", refId: id });
    await logAudit(actor, "restok", "part", id, `Restok ${part.nama}: ${part.stok} → ${stok}`);
  });
}
export async function adjustPart(user: User, id: string, stock: number, reason: string) {
  return operation(user, "stock", async (actor) => {
    amount(stock, "Stok"); if (!reason.trim()) throw new Error("Alasan wajib diisi");
    const part = await db.parts.get(id); if (!part) throw new Error("Item tidak ditemukan");
    await db.parts.update(id, { stok: stock });
    await logAudit(actor, "opname", "part", id, `${part.nama}: ${part.stok} → ${stock}. ${reason}`);
  });
}
