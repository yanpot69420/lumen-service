import { logAudit } from "./audit";
import { db } from "./db";
import { operation } from "./operations";
import catalog from "./seeds/spareparts.json";
import { isCloud } from "./supabase";
import type { Part, User } from "./types";

export const STARTER_PARTS: readonly Part[] = catalog.map((part) => ({
  ...part,
  kategori: "sparepart",
  stok: 0,
  hargaModal: 0,
  hargaJual: 0,
}));

function identity(part: Pick<Part, "nama" | "kategori">) {
  return `${part.kategori}:${part.nama.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/** Adds missing catalog rows only. Restocking and pricing remain explicit actions. */
export async function seedParts(user: User) {
  if (isCloud) throw new Error("Katalog awal cloud dimuat lewat supabase/seed.sql oleh administrator.");
  return operation(user, "stock", async (actor) => {
    const current = await db.parts.toArray();
    const ids = new Set(current.map((part) => part.id));
    const names = new Set(current.map(identity));
    const missing = STARTER_PARTS.filter((part) => !ids.has(part.id) && !names.has(identity(part)));
    if (missing.length) {
      await db.parts.bulkAdd(missing.map((part) => ({ ...part })));
      await logAudit(actor, "seed", "part", "starter-spareparts-v1", `Muat ${missing.length} sparepart katalog awal; stok dan harga nol`);
    }
    return { added: missing.length, skipped: STARTER_PARTS.length - missing.length };
  });
}
