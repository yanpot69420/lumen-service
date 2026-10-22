import { can, type Permission } from "@/auth/roles";
import { currentUndoCapture, db, setTransactionActor } from "./db";
import type { User } from "./types";

export const businessTables = () => [db.users, db.settings, db.customers, db.tickets, db.units, db.parts, db.cash, db.dayCloses, db.corrections, db.audit, db.photos, db.outbox];
export function amount(value: number, label = "Nominal", positive = false) {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) throw new Error(`${label} harus berupa bilangan bulat ${positive ? "positif" : "nol atau positif"}`);
}
export async function operation<T>(user: User, permission: Permission, fn: (actor: User) => Promise<T>): Promise<T> {
  return db.transaction("rw", businessTables(), async () => {
    const actor = await db.users.get(user.id);
    if (!actor?.active || !can(actor.role, permission)) throw new Error("Anda tidak memiliki akses untuk tindakan ini");
    setTransactionActor(actor.id);
    currentUndoCapture()?.permissions.add(permission);
    return fn(actor);
  });
}
