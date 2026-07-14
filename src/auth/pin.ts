import type { User } from "@/db/types";

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const PBKDF2_ITER = 310_000;

/** Hash PIN v2: PBKDF2-SHA256 — memperlambat brute force offline. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc(salt), iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    256,
  );
  return hex(bits);
}

/** Hash v1 (SHA-256 sekali) — hanya untuk memverifikasi akun lama. */
async function hashPinLegacy(pin: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc(`${salt}:${pin}`));
  return hex(digest);
}

/** Verifikasi PIN; beri tahu bila hash perlu di-upgrade ke v2. */
export async function verifyPin(
  user: Pick<User, "pinHash" | "salt" | "pinVer">,
  pin: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (user.pinVer === 2) {
    return { ok: (await hashPin(pin, user.salt)) === user.pinHash, needsUpgrade: false };
  }
  const ok = (await hashPinLegacy(pin, user.salt)) === user.pinHash;
  return { ok, needsUpgrade: ok };
}

export function newSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Kode pemulihan PIN: 12 karakter tanpa huruf ambigu (0/O, 1/I/L). */
export function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}
