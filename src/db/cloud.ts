import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isCloud } from "./supabase";

/**
 * Koneksi ke akun cloud toko (Supabase Auth). Satu akun dipakai bersama semua
 * perangkat toko; sesi disimpan otomatis oleh Supabase (localStorage), jadi
 * perangkat tetap terhubung setelah connect sekali.
 *
 * Catatan keamanan: sign-up publik DIMATIKAN di project. Akun cloud toko dibuat
 * owner lewat dashboard Supabase; di sini hanya sign-in.
 */
export async function connectCloud(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Cloud belum dikonfigurasi" };
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disconnectCloud(): Promise<void> {
  await supabase?.auth.signOut();
}

export interface CloudStatus {
  configured: boolean; // env terisi
  session: Session | null;
  email: string | null;
  ready: boolean;
}

/** Status koneksi cloud, reaktif terhadap sign-in/sign-out. */
export function useCloudStatus(): CloudStatus {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isCloud);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    configured: isCloud,
    session,
    email: session?.user?.email ?? null,
    ready,
  };
}
