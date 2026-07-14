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
  await supabase?.auth.signOut();
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
  store: { name: string; phone: string };
  owner: { name: string; username: string; pin: string };
  headops: { name: string; username: string; pin: string };
}

export async function cloudSetup(
  input: CloudSetupInput,
): Promise<{ ok: boolean; recoveryCode?: string; error?: string }> {
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
): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const res = await invokeAuth("login", { username, pin });
  if (!res?.ok) return { ok: false, error: res?.error };
  if (!(await adoptSession(res.tokenHash)))
    return { ok: false, error: "Gagal membuat sesi" };
  await pullCore();
  const userId = String(res.email ?? "").split("@")[0] || undefined;
  return { ok: true, userId };
}
