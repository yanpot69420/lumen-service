import { hashPin, newSalt } from "@/auth/pin";
import { db } from "./db";
import { supabase } from "./supabase";
import { pullCore } from "./sync";

export { isCloud } from "./supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function invokeAuth(action: string, payload: object): Promise<any> {
  if (!supabase) return { ok: false, error: "Cloud nonaktif" };
  const { data, error } = await supabase.functions.invoke("auth", {
    body: { action, ...payload },
  });
  if (error) {
    const ctx = (error as any).context;
    if (ctx?.json) {
      try {
        return await ctx.json();
      } catch {
        /* abaikan */
      }
    }
    return { ok: false, error: error.message };
  }
  return data;
}

/** Tukar token_hash dari Edge Function menjadi sesi Supabase di perangkat ini. */
async function adoptSession(tokenHash: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  return !error;
}

export async function cloudSignOut(): Promise<void> {
  // The SDK also clears its refresh lifecycle and broadcasts SIGNED_OUT when
  // the server cannot be reached. Removing storage alone skips that cleanup.
  try { await supabase?.auth.signOut({ scope: "local" }); }
  finally { localStorage.removeItem("lumen.cloud.session"); }
}

/** Apakah toko sudah di-setup di cloud (ada user)? Dipakai untuk memutuskan
 *  tampilkan Setup atau Login, tanpa bergantung pada cache lokal. */
export async function cloudStatus(): Promise<{
  ok: boolean;
  hasUsers: boolean;
}> {
  const res = await invokeAuth("status", {});
  if (!res?.ok) return { ok: false, hasUsers: false };
  return { ok: true, hasUsers: !!res.hasUsers };
}

export interface CloudSetupInput {
  setupToken?: string;
  store: { name: string; phone: string; };
  owner: { name: string; username: string; pin: string; };
  headops: { name: string; username: string; pin: string; };
}

export async function cloudSetup(
  input: CloudSetupInput,
): Promise<{ ok: boolean; recoveryCode?: string; error?: string; }> {
  const res = await invokeAuth("setup", input);
  if (!res?.ok) return { ok: false, error: res?.error ?? "Setup cloud gagal" };
  if (!(await adoptSession(res.tokenHash)))
    return { ok: false, error: "Gagal membuat sesi" };
  await pullCore();
  return { ok: true, recoveryCode: res.recoveryCode };
}

/** Verifikasi PIN di server & buat sesi cloud; users ikut tersinkron ke lokal.
 *  Mengembalikan userId agar klien bisa set sesi langsung tanpa hash PIN ulang. */
export async function cloudLogin(
  username: string,
  pin: string,
): Promise<{ ok: boolean; userId?: string; error?: string; }> {
  const res = await invokeAuth("login", { username, pin });
  if (!res?.ok) return { ok: false, error: res?.error };
  if (!(await adoptSession(res.tokenHash)))
    return { ok: false, error: "Gagal membuat sesi" };
  await pullCore();
  const userId = res.userId as string | undefined;
  if (userId) await rememberOfflineLogin(userId, pin);
  return { ok: true, userId };
}

export async function cloudRecover(username: string, code: string, newPin: string) {
  const res = await invokeAuth("recover", { username, code, newPin });
  if (!res?.ok) throw new Error(res?.error ?? "Pemulihan PIN gagal");
  await forgetOfflineLogin();
}
export async function manageCloudAccount(action: string, payload: object = {}) {
  const res = await invokeAuth(action, payload);
  if (!res?.ok) throw new Error(res?.error ?? "Perubahan akun gagal");
  if (action === "reset-pin" || action === "deactivate-user") {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === "string") await forgetOfflineLogin(userId);
  }
  if (res.tokenHash && !await adoptSession(res.tokenHash)) throw new Error("PIN berubah. Silakan login ulang.");
  await pullCore();
  return res;
}
const OFFLINE_KEY = "offline.login";
interface OfflineCredential { userId: string; username: string; pinHash: string; salt: string; expires: number; }
async function readOfflineLogin(): Promise<OfflineCredential | null> {
  const raw = await db.settings.get(OFFLINE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw.value) as OfflineCredential | null;
    if (!value || typeof value.userId !== "string" || !value.userId || typeof value.username !== "string" ||
      typeof value.pinHash !== "string" || !value.pinHash || typeof value.salt !== "string" || !value.salt ||
      !Number.isSafeInteger(value.expires)) return null;
    return value;
  } catch { return null; }
}
async function rememberOfflineLogin(userId: string, pin: string) {
  const user = await db.users.get(userId); if (!user) throw new Error("Profil staf belum tersedia");
  const salt = newSalt();
  const record: OfflineCredential = { userId, username: user.username, pinHash: await hashPin(pin, salt), salt, expires: Date.now() + 24 * 3600000 };
  await db.settings.put({ key: OFFLINE_KEY, value: JSON.stringify(record) });
}
export async function offlineLogin(username: string, pin: string) {
  const record = await readOfflineLogin();
  if (!record || record.username !== username.trim().toLowerCase() || record.expires < Date.now()) return null;
  const user = await db.users.get(record.userId);
  if (!user?.active || user.username !== record.username || await hashPin(pin, record.salt) !== record.pinHash) return null;
  return user.id;
}
export async function offlineSessionValid(userId: string) {
  const value = await readOfflineLogin();
  if (!value || value.userId !== userId || value.expires < Date.now()) return false;
  const user = await db.users.get(userId);
  return !!user?.active && user.username === value.username;
}
export async function forgetOfflineLogin(userId?: string) {
  if (userId !== undefined && (await readOfflineLogin())?.userId !== userId) return;
  await db.settings.delete(OFFLINE_KEY);
}
