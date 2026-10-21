import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { hashPin, salt, digest, equal, recoveryCode, validPin, validUsername } from "../_shared/pin.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
type StaffInput = { name: string; username: string; pin: string };
function staffInput(raw: unknown): StaffInput {
  const u = raw as StaffInput;
  if (!u || typeof u.name !== "string" || !u.name.trim() || u.name.length > 80 || !validUsername(u.username) || !validPin(u.pin)) throw new Error("Data staf tidak valid");
  return { ...u, name: u.name.trim() };
}
export function createAuthHandler(admin: SupabaseClient, setupToken: string) {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(`Layanan akun belum dapat memproses permintaan: ${error.message}`);
    return data;
  }
  async function mintSession(id: string) {
    const email = `${id}@lumen.local`;
    await admin.auth.admin.createUser({ id, email, email_confirm: true, password: salt() + salt() });
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.hashed_token || !data.user) throw new Error("Gagal membuat sesi");
    const updated = await admin.from("users").update({ auth_id: data.user.id }).eq("id", id);
    if (updated.error) throw new Error("Gagal menghubungkan sesi staf");
    return data.properties.hashed_token;
  }
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return json({ ok: false, error: "Method tidak diizinkan" }, 405);
    let body: Record<string, unknown>;
    try {
      const text = await req.text(); if (text.length > 12000) return json({ ok: false, error: "Permintaan terlalu besar" }, 413);
      body = JSON.parse(text); if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    } catch { return json({ ok: false, error: "Body harus objek JSON" }, 400); }
    const action = String(body.action ?? "");
    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const allowed = await rpc("auth_allow", { p_key: `ip:${await digest(ip)}`, p_limit: 60, p_seconds: 900 });
      if (!allowed) return json({ ok: false, error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." }, 429);
      if (action === "status") {
        const { count, error } = await admin.from("users").select("id", { count: "exact", head: true });
        if (error || count === null) return json({ ok: false, error: "Status toko belum dapat diperiksa" }, 503);
        return json({ ok: true, hasUsers: count > 0 });
      }
      if (action === "setup") {
        if (!setupToken) return json({ ok: false, error: "Administrator perlu mengatur token setup cloud terlebih dahulu" }, 503);
        if (typeof body.setupToken !== "string" || !equal(body.setupToken, setupToken)) return json({ ok: false, error: "Token setup tidak valid" }, 403);
        const owner = staffInput(body.owner); const ops = staffInput(body.headops);
        const store = body.store as { name: string; phone?: string };
        if (!store || typeof store.name !== "string" || !store.name.trim() || store.name.length > 120 || owner.username === ops.username) return json({ ok: false, error: "Data setup tidak valid" }, 400);
        const code = recoveryCode(); const recoverySalt = salt();
        const users = await Promise.all([owner, ops].map(async (u, index) => { const s = salt(); return { id: crypto.randomUUID(), name: u.name, username: u.username, role: index ? "headops" : "owner", pin_hash: await hashPin(u.pin, s), salt: s, ...(!index ? { recovery_hash: await hashPin(code, recoverySalt), recovery_salt: recoverySalt } : {}) }; }));
        const id = await rpc("bootstrap_store", { p_store: { name: store.name.trim(), phone: String(store.phone ?? "").slice(0,32) }, p_users: users });
        return json({ ok: true, userId: id, recoveryCode: code, tokenHash: await mintSession(id) });
      }
      if (action === "login" || action === "recover") {
        const username = String(body.username ?? "").trim().toLowerCase();
        if (!validUsername(username) || !validPin(action === "recover" ? body.newPin : body.pin)) return json({ ok: false, error: "Username/PIN tidak valid" }, 400);
        if (!await rpc("auth_allow", { p_key: `account:${await digest(username)}`, p_limit: 10, p_seconds: 900 })) return json({ ok: false, error: "Akun sementara dikunci setelah beberapa percobaan. Coba lagi dalam 15 menit." }, 429);
        const user = await rpc("auth_lookup", { p_username: username });
        if (action === "recover") {
          const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
          const normalized = `${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`;
          const hash = await hashPin(normalized, user?.recovery_salt ?? "unavailable");
          if (code.length !== 12 || !user?.active || !user.recovery_hash || !equal(hash, user.recovery_hash)) return json({ ok: false, error: "Username atau kode pemulihan salah" }, 401);
          const s = salt();
          await rpc("auth_recover", { p_user_id: user.id, p_expected: hash, p_hash: await hashPin(String(body.newPin), s), p_salt: s });
          return json({ ok: true });
        }
        const pin = String(body.pin);
        const hash = user?.pin_ver === 1 ? await digest(`${user.salt}:${pin}`) : await hashPin(pin, user?.salt ?? "unavailable");
        if (!user?.active || !equal(hash, user.pin_hash)) return json({ ok: false, error: "Username atau PIN salah" }, 401);
        if (user.pin_ver === 1) await rpc("auth_upgrade", { p_user_id: user.id, p_expected: user.pin_hash, p_hash: await hashPin(pin, user.salt) });
        return json({ ok: true, userId: user.id, tokenHash: await mintSession(user.id) });
      }
      // Management always verifies the real JWT, then checks Owner in SQL.
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const authenticated = token ? await admin.auth.getUser(token) : null;
      if (!authenticated?.data.user || authenticated.error) return json({ ok: false, error: "Sesi tidak valid" }, 401);
      const authId = authenticated.data.user.id;
      const claims = JSON.parse(atob(token!.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
      const sessionId = claims.session_id;
      const { data: actor } = await admin.from("users").select("id,role,active").eq("auth_id", authId).single();
      if (!actor?.active || actor.role !== "owner") return json({ ok: false, error: "Tindakan khusus Owner" }, 403);
      if (action === "create-user") {
        const u = staffInput(body.user);
        if (!["headops", "kasir", "teknisi"].includes(String(body.role))) return json({ ok: false, error: "Peran tidak valid" }, 400);
        const s = salt(); const id = crypto.randomUUID();
        await rpc("manage_staff", { p_actor_auth: authId, p_session: sessionId, p_target: id, p_profile: { name: u.name, username: u.username, role: body.role }, p_credentials: { pin_hash: await hashPin(u.pin, s), salt: s } });
        return json({ ok: true });
      }
      if (action === "reset-pin") {
        if (!validPin(body.pin) || typeof body.userId !== "string") return json({ ok: false, error: "PIN/pengguna tidak valid" }, 400);
        const s = salt();
        await rpc("manage_staff", { p_actor_auth: authId, p_session: sessionId, p_target: body.userId, p_credentials: { pin_hash: await hashPin(body.pin, s), salt: s } });
        return json({ ok: true, ...(body.userId === actor.id ? { tokenHash: await mintSession(actor.id) } : {}) });
      }
      if (action === "deactivate-user") {
        await rpc("manage_staff", { p_actor_auth: authId, p_session: sessionId, p_target: body.userId, p_profile: { active: false } }); return json({ ok: true });
      }
      if (action === "recovery-code") {
        const code = recoveryCode(); const s = salt();
        await rpc("manage_staff", { p_actor_auth: authId, p_session: sessionId, p_target: actor.id, p_credentials: { recovery_hash: await hashPin(code, s), recovery_salt: s } });
        return json({ ok: true, recoveryCode: code });
      }
      return json({ ok: false, error: "Aksi tidak dikenal" }, 400);
    } catch (error) {
      console.error("[auth]", error instanceof Error ? error.message : "failure");
      return json({ ok: false, error: error instanceof Error ? error.message : "Layanan akun sedang bermasalah" }, 503);
    }
  };
}
