import { luhnValidImei } from "@/lib/imei";
import { logAudit } from "./audit";
import { addCash } from "./cash";
import { db, uid } from "./db";
import { amount, operation } from "./operations";
import { nextNota } from "./settings";
import type { CashMethod, Unit, User } from "./types";

export async function buyUnit(
  user: User,
  data: Pick<
    Unit,
    | "brand"
    | "model"
    | "varian"
    | "imei"
    | "kondisi"
    | "hargaBeli"
    | "hargaJual"
    | "sellerName"
    | "sellerPhone"
    | "garansiHari"
  >,
  photos: Blob[],
  ktpPhoto: Blob | null,
  method: CashMethod = "tunai",
  requestId = uid(),
): Promise<Unit> {
  return operation(user, "purchase", async (user) => {
    const existing = await db.units.get(requestId);
    if (existing) return existing;
    amount(data.hargaBeli, "Harga beli", true); amount(data.hargaJual); amount(data.garansiHari);
    if (!luhnValidImei(data.imei)) throw new Error("IMEI harus 15 digit dan digit cek valid");
    if (!data.brand.trim() || !data.sellerName.trim() || !photos.length || !ktpPhoto) throw new Error("Data unit, foto kondisi, dan foto KTP wajib diisi");
    if (await db.units.where("imei").equals(data.imei).and((u) => u.status === "stok").count()) throw new Error("Unit ber-IMEI sama masih ada di stok");
    const kode = await nextNota("unit");
    const now = Date.now();
    const unit: Unit = {
      ...data,
      id: requestId,
      kode,
      status: "stok",
      boughtAt: now,
      createdBy: user.id,
    };
    await db.units.add(unit);
    for (const blob of photos) {
      await db.photos.add({
        id: uid(),
        refType: "unit",
        refId: unit.id,
        blob,
        createdAt: now,
      });
    }
    if (ktpPhoto) {
      await db.photos.add({
        id: uid(),
        refType: "unit-ktp",
        refId: unit.id,
        blob: ktpPhoto,
        createdAt: now,
      });
    }
    await addCash(user, {
      type: "out",
      category: "beli_unit",
      amount: data.hargaBeli,
      method,
      note: `Beli ${kode}: ${data.brand} ${data.model} (${data.sellerName})`,
      refType: "unit",
      refId: unit.id,
    });
    await logAudit(
      user,
      "beli",
      "unit",
      unit.id,
      `${kode}: ${data.brand} ${data.model}, IMEI ${data.imei}, ${data.sellerName}`,
    );
    const drafts = await db.photos.where("refId").anyOf(["beli-baru", "beli-baru-ktp"]).and((p) => p.refType === "draft").primaryKeys();
    await db.photos.bulkDelete(drafts);
    await db.settings.put({ key: "draftBeliBaru", value: "" });
    return unit;
  });
}

export async function sellUnit(
  user: User,
  unit: Unit,
  sale: {
    soldPrice: number;
    buyerName: string;
    buyerPhone: string;
    garansiHari: number;
    method: CashMethod;
  },
) {
  return operation(user, "sell", async (user) => {
    amount(sale.soldPrice, "Harga jual", true); amount(sale.garansiHari);
    const fresh = await db.units.get(unit.id);
    if (!fresh || fresh.status !== "stok") throw new Error("Unit sudah terjual atau tidak ditemukan");
    unit = fresh;
    const now = Date.now();
    await db.units.update(unit.id, {
      status: "terjual",
      soldAt: now,
      soldPrice: sale.soldPrice,
      buyerName: sale.buyerName,
      buyerPhone: sale.buyerPhone,
      garansiHari: sale.garansiHari,
    });
    await addCash(user, {
      type: "in",
      category: "jual_unit",
      amount: sale.soldPrice,
      method: sale.method,
      note: `Jual ${unit.kode}: ${unit.brand} ${unit.model}${sale.buyerName ? ` (${sale.buyerName})` : ""}`,
      refType: "unit",
      refId: unit.id,
      meta: { modal: unit.hargaBeli },
    });
    await logAudit(
      user,
      "jual",
      "unit",
      unit.id,
      `${unit.kode} terjual — margin tercatat`,
    );
  });
}

/**
 * Retur unit terjual: unit kembali ke stok, refund tercatat sebagai kas
 * keluar `retur_unit` dengan snapshot modal — laporan bulan retur mencatat
 * margin negatif tanpa mengubah laporan bulan penjualan.
 */
export async function returUnit(
  user: User,
  unit: Unit,
  ret: { refund: number; method: CashMethod; alasan: string; },
) {
  return operation(user, "purchase", async (user) => {
    amount(ret.refund, "Refund");
    if (!ret.alasan.trim()) throw new Error("Alasan retur wajib diisi");
    const fresh = await db.units.get(unit.id);
    if (!fresh || fresh.status !== "terjual") throw new Error("Unit sudah diretur atau tidak ditemukan");
    unit = fresh;
    if (await db.units.where("imei").equals(unit.imei).and((u) => u.id !== unit.id && u.status === "stok").count()) throw new Error("Unit ber-IMEI sama masih ada di stok. Periksa pencatatan unit sebelum melakukan retur.");
    if (ret.refund > (unit.soldPrice ?? 0)) throw new Error("Refund melebihi harga jual");
    const detail = `harga jual ${unit.soldPrice}, refund ${ret.refund}, pembeli ${unit.buyerName || "-"}`;
    await db.units.update(unit.id, {
      status: "stok",
      soldAt: undefined,
      soldPrice: undefined,
      buyerName: undefined,
      buyerPhone: undefined,
    });
    // Even a fully deducted refund must reverse the cost of the unit now
    // returned to stock, so a later resale does not charge that cost twice.
    await addCash(user, {
      type: "out",
      category: "retur_unit",
      amount: ret.refund,
      method: ret.method,
      note: `Retur ${unit.kode}: ${unit.brand} ${unit.model} — ${ret.alasan}`,
      refType: "unit",
      refId: unit.id,
      meta: { modal: unit.hargaBeli },
    });
    await logAudit(
      user,
      "retur",
      "unit",
      unit.id,
      `${unit.kode} retur (${ret.alasan}); ${detail}`,
    );
  });
}

export async function setUnitPrice(user: User, id: string, price: number) {
  return operation(user, "purchase", async (actor) => {
    amount(price);
    const unit = await db.units.get(id);
    if (!unit || unit.status !== "stok") throw new Error("Harga hanya dapat diubah untuk unit stok");
    await db.units.update(id, { hargaJual: price });
    await logAudit(actor, "harga", "unit", id, `${unit.kode}: harga jual → ${price}`);
  });
}
