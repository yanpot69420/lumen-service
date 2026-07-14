import type { Role } from "@/db/types";

/** Peran yang boleh melihat harga modal, margin, laba, dan nilai stok. */
export function canSeeMoney(role: Role): boolean {
  return role === "owner" || role === "headops";
}
