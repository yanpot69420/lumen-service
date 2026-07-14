import { db, uid } from "./db";
import { addCash } from "./cash";
import { logAudit } from "./audit";
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
): Promise<Unit> {
  const kode = await nextNota("unit");
  const now = Date.now();
  const unit: Unit = {
    ...data,
    id: uid(),
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
  return unit;
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
}

/**
 * Retur unit terjual: unit kembali ke stok, refund tercatat sebagai kas
 * keluar `retur_unit` dengan snapshot modal — laporan bulan retur mencatat
 * margin negatif tanpa mengubah laporan bulan penjualan.
 */
export async function returUnit(
  user: User,
  unit: Unit,
  ret: { refund: number; method: CashMethod; alasan: string },
) {
  const detail = `harga jual ${unit.soldPrice}, refund ${ret.refund}, pembeli ${unit.buyerName || "-"}`;
  await db.units.update(unit.id, {
    status: "stok",
    soldAt: undefined,
    soldPrice: undefined,
    buyerName: undefined,
    buyerPhone: undefined,
  });
  if (ret.refund > 0) {
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
  }
  await logAudit(
    user,
    "retur",
    "unit",
    unit.id,
    `${unit.kode} retur (${ret.alasan}); ${detail}`,
  );
}
