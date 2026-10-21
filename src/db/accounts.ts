import { hashPin, newRecoveryCode, newSalt } from "@/auth/pin";
import { USERNAME_RE } from "@/lib/username";
import { logAudit } from "./audit";
import { isCloud, manageCloudAccount } from "./cloud";
import { db, uid } from "./db";
import { operation } from "./operations";
import type { Role, User } from "./types";

export async function createAccount(actor: User, input: { name: string; username: string; role: Role; pin: string; }) {
  if (!input.name.trim() || !USERNAME_RE.test(input.username) || !/^\d{4,6}$/.test(input.pin) || !["headops", "kasir", "teknisi"].includes(input.role)) throw new Error("Data pengguna tidak valid");
  if (isCloud) return manageCloudAccount("create-user", { user: input, role: input.role });
  const salt = newSalt(); const pinHash = await hashPin(input.pin, salt);
  return operation(actor, "users", async (user) => {
    const id = uid();
    await db.users.add({ id, name: input.name.trim(), username: input.username, role: input.role, salt, pinHash, pinVer: 2, active: 1, createdAt: Date.now() });
    await logAudit(user, "buat", "pengguna", id, `Pengguna baru: ${input.username}`);
  });
}
export async function resetAccountPin(actor: User, target: string, pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw new Error("PIN harus 4–6 digit");
  if (isCloud) return manageCloudAccount("reset-pin", { userId: target, pin });
  const salt = newSalt(); const pinHash = await hashPin(pin, salt);
  return operation(actor, "users", async (user) => {
    if (!await db.users.get(target)) throw new Error("Pengguna tidak ditemukan");
    await db.users.update(target, { salt, pinHash, pinVer: 2 });
    await logAudit(user, "pin", "pengguna", target, "PIN direset oleh Owner");
  });
}
export async function deactivateAccount(actor: User, target: string) {
  if (actor.id === target) throw new Error("Anda tidak dapat menonaktifkan diri sendiri");
  if (isCloud) return manageCloudAccount("deactivate-user", { userId: target });
  return operation(actor, "users", async (user) => {
    await db.users.update(target, { active: 0 });
    await logAudit(user, "nonaktif", "pengguna", target, "Pengguna dinonaktifkan");
  });
}
export async function renewRecoveryCode(actor: User): Promise<string> {
  if (isCloud) return (await manageCloudAccount("recovery-code")).recoveryCode;
  const code = newRecoveryCode(); const salt = newSalt(); const hash = await hashPin(code, salt);
  await operation(actor, "users", async (user) => {
    await db.users.update(actor.id, { recoveryHash: hash, recoverySalt: salt });
    await logAudit(user, "kode-pemulihan", "pengguna", user.id, "Kode pemulihan diperbarui");
  });
  return code;
}
