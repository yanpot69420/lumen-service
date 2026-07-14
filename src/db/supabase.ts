import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Klien Supabase — null bila kredensial belum diisi (mode lokal murni).
 * Semua kode integrasi harus memeriksa `isCloud` sebelum memakainya, agar
 * aplikasi tetap berfungsi penuh secara offline/lokal.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const isCloud = supabase !== null;
