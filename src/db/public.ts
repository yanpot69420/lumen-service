import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "./db";
import { ticketSisa, ticketTotal } from "./money";
import { isCloud, supabase } from "./supabase";
import type { TicketStatus } from "./types";
export interface PublicProduct { id?: string; kode: string; brand: string; model: string; varian: string; kondisi: string; hargaJual: number; garansiHari: number; photoUrl?: string; }
export interface PublicStatus { noNota: string; brand: string; model: string; status: TicketStatus; total: number; dp: number; sisa: number; history: { status: TicketStatus; at: number; }[]; }
async function invoke<T>(action: string, payload: object = {}): Promise<T> {
  const { data, error } = await supabase!.functions.invoke("public", { body: { action, ...payload } });
  if (error || !data?.ok) throw new Error(data?.error ?? "Layanan publik belum dapat dihubungi. Silakan hubungi konter.");
  return data.data as T;
}
export const publicProfile = () => invoke<Record<string, string>>("profile");
export async function findPublicStatus(nota: string, suffix: string): Promise<PublicStatus | null> {
  if (isCloud) return invoke("status", { nota, suffix });
  const t = await db.tickets.where("noNota").equals(nota).first();
  if (!t || t.phone.replace(/\D/g, "").slice(-4) !== suffix || !/^\d{4}$/.test(suffix)) return null;
  return { noNota: t.noNota, brand: t.brand, model: t.model, status: t.status, total: ticketTotal(t), dp: t.dp, sisa: ticketSisa(t), history: t.history.map(({ status, at }) => ({ status, at })) };
}
export function usePublicCatalog() {
  const local = useLiveQuery<PublicProduct[]>(async () => isCloud ? [] : await db.units.where("status").equals("stok").filter((u) => u.hargaJual > 0).sortBy("boughtAt"), []);
  const [remote, setRemote] = useState<PublicProduct[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isCloud) return; let cancelled = false;
    void (async () => {
      const items: PublicProduct[] = []; let after: string | null = null;
      do {
        const page: { rows: PublicProduct[]; next: string | null; } = await invoke("catalog", { after });
        items.push(...page.rows); after = page.next;
      } while (after);
      if (!cancelled) setRemote(items);
    })().catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);
  return { units: isCloud ? remote : local, error };
}
