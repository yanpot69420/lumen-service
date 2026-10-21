import type { Role } from "@/db/types";

/** Peran yang boleh melihat harga modal, margin, laba, dan nilai stok. */
export function canSeeMoney(role: Role): boolean {
  return role === "owner" || role === "headops";
}
export type Permission = "service" | "sell" | "purchase" | "stock" | "cash" | "close" | "settings" | "approve" | "users" | "photo" | "correction" | "customers";
export function can(role: Role, action: Permission): boolean {
  if (action === "approve" || action === "users") return role === "owner";
  if (role === "owner" || role === "headops") return true;
  if (role === "kasir") return ["service", "sell", "photo", "correction", "customers"].includes(action);
  return ["service", "photo"].includes(action);
}
