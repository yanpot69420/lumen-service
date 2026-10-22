import { canSeeMoney } from "@/auth/roles";
import { db } from "./db";
import type { Correction, User } from "./types";

/** Match sync_page even when this device still contains an Owner's cache.
 * Return copies: access restrictions must never rewrite durable offline work. */
export function visibleCorrections(rows: Correction[], actor: Pick<User, "id" | "role">): Correction[] {
  if (canSeeMoney(actor.role)) return rows;
  return rows.filter((row) => row.requestedBy === actor.id).map((row) => {
    const { purchase: _before, ...before } = row.before;
    const { purchase: _after, ...after } = row.after;
    return { ...row, before, after };
  });
}
export async function readCorrectionsFor(actor: Pick<User, "id" | "role">) {
  const rows = canSeeMoney(actor.role)
    ? await db.corrections.orderBy("at").reverse().toArray()
    : await db.corrections.filter((row) => row.requestedBy === actor.id).reverse().sortBy("at");
  return visibleCorrections(rows, actor);
}
