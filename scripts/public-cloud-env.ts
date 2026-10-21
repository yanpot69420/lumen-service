/** Only public connection values may cross from the build environment into Vite. */
export function publicCloudEnv(env: Record<string, string | undefined>) {
  const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
  const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "";
  if (!!url !== !!key) throw new Error("Konfigurasi Supabase belum lengkap: URL dan anon/publishable key harus diisi bersama.");
  let role: unknown;
  try { role = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString()).role; } catch { /* New publishable keys are not JWTs. */ }
  if (key.startsWith("sb_secret_") || role === "service_role") throw new Error("Kunci rahasia Supabase tidak boleh dipakai di frontend. Gunakan anon/publishable key.");
  return { url, key };
}
