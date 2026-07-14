// Lumen Service — Edge Function "auth"
// =====================================
// Mengubah login username+PIN menjadi sesi Supabase yang aman, tanpa akun toko
// terpisah. Berjalan dengan service_role (bypass RLS) — HANYA fungsi ini yang
// boleh memverifikasi PIN dan mencetak sesi.
//
// Aksi (POST JSON { action, ... }):
//   • "setup" : bootstrap 2 user awal (owner + headops) bila tabel users kosong,
//               lalu cetak sesi untuk owner. Mengembalikan kode pemulihan owner.
//   • "login" : verifikasi username+PIN, cetak sesi untuk staf tsb.
//
// Sesi dicetak via admin.generateLink (magiclink) → token_hash; klien menukarnya
// dengan supabase.auth.verifyOtp({ type: "magiclink", token_hash }).
//
// Deploy: Dashboard → Edge Functions → Create function "auth" → tempel file ini
// → Deploy. Tidak perlu konfigurasi SMTP (generateLink tidak mengirim email).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 310_000, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

const randHex = (n: number) =>
  toHex(crypto.getRandomValues(new Uint8Array(n)).buffer);

function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const c = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${c.slice(0, 4).join("")}-${c.slice(4, 8).join("")}-${c.slice(8).join("")}`;
}

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

/** Pastikan ada Auth user bayangan untuk staf (email deterministik), lalu
 *  cetak token_hash yang bisa ditukar jadi sesi oleh klien. */
async function mintSession(userId: string): Promise<string> {
  const email = `${userId}@lumen.local`;
  // createUser idempoten: abaikan bila sudah ada.
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randHex(24),
    user_metadata: { lumen_user_id: userId },
  }).catch(() => {});
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(error?.message ?? "Gagal mencetak sesi");
  }
  return data.properties.hashed_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body harus JSON" }, 400);
  }
  const action = body.action;

  try {
    if (action === "status") {
      // Apakah toko sudah di-setup (ada user)? Aman diekspos — hanya boolean.
      const { count } = await admin
        .from("users")
        .select("id", { count: "exact", head: true });
      return json({ ok: true, hasUsers: (count ?? 0) > 0 });
    }

    if (action === "setup") {
      const { count } = await admin
        .from("users")
        .select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0) return json({ error: "Toko sudah di-setup" }, 409);

      const store = body.store as { name: string; phone?: string };
      const mk = async (
        u: { name: string; username: string; pin: string },
        role: "owner" | "headops",
      ) => {
        const salt = randHex(16);
        return {
          id: crypto.randomUUID(),
          name: u.name.trim(),
          username: u.username.trim().toLowerCase(),
          role,
          pin_hash: await hashPin(u.pin, salt),
          pin_ver: 2,
          salt,
          active: true,
          created_at: new Date().toISOString(),
        };
      };
      const owner = await mk(body.owner as never, "owner");
      const headops = await mk(body.headops as never, "headops");

      const recoveryCode = newRecoveryCode();
      const recoverySalt = randHex(16);
      (owner as Record<string, unknown>).recovery_hash = await hashPin(
        recoveryCode,
        recoverySalt,
      );
      (owner as Record<string, unknown>).recovery_salt = recoverySalt;

      const { error: uErr } = await admin.from("users").insert([owner, headops]);
      if (uErr) throw new Error(uErr.message);
      await admin.from("settings").upsert([
        { key: "storeName", value: store.name.trim() },
        { key: "storePhone", value: (store.phone ?? "").trim() },
      ]);
      await admin.from("audit_log").insert({
        user_id: owner.id,
        user_name: owner.name,
        action: "setup",
        entity: "sistem",
        entity_id: "-",
        summary: `Setup awal: toko "${store.name.trim()}", 2 pengguna dibuat`,
      });

      const tokenHash = await mintSession(owner.id);
      return json({
        ok: true,
        recoveryCode,
        tokenHash,
        email: `${owner.id}@lumen.local`,
      });
    }

    if (action === "login") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const pin = String(body.pin ?? "");
      const { data: user } = await admin
        .from("users")
        .select("*")
        .eq("username", username)
        .eq("active", true)
        .maybeSingle();
      if (!user) return json({ ok: false });

      const hash = await hashPin(pin, user.salt);
      if (hash !== user.pin_hash) return json({ ok: false });

      const tokenHash = await mintSession(user.id);
      return json({ ok: true, tokenHash, email: `${user.id}@lumen.local` });
    }

    return json({ error: "Aksi tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
