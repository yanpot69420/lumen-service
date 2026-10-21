import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { digest } from "../_shared/pin.ts";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type", "Access-Control-Allow-Methods": "POST,OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
const json = (value: unknown, status=200) => new Response(JSON.stringify(value), { status, headers });
export function createPublicHandler(admin: SupabaseClient) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers });
    if (req.method !== "POST") return json({ ok: false },405);
    try {
      const text = await req.text(); if (text.length>2000) return json({ ok:false },413);
      const body = JSON.parse(text);
      if (!body || !["profile","catalog","status"].includes(body.action)) return json({ ok:false },400);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const limit = await admin.rpc("auth_allow", { p_key: `public:${await digest(ip)}`, p_limit:60, p_seconds:60 });
      if (limit.error) return json({ ok:false,error:"Layanan publik belum siap" },503);
      if (!limit.data) return json({ ok:false,error:"Terlalu banyak permintaan. Coba lagi sebentar." },429);
      const { data,error } = await admin.rpc("read_public", { p_action:body.action,p_payload:{ after: typeof body.after==="string" ? body.after.slice(0,100):null,nota:String(body.nota??"").slice(0,100),suffix:String(body.suffix??"") } });
      if (error) return json({ ok:false,error:"Data belum dapat diambil" },503);
      if (body.action==="catalog") {
        data.rows = await Promise.all(data.rows.map(async (row: Record<string,unknown>) => {
          const { photoPath,...product } = row;
          if (typeof photoPath!=="string") return product;
          const signed = await admin.storage.from("photos").createSignedUrl(photoPath,900);
          return { ...product,photoUrl:signed.data?.signedUrl };
        }));
      }
      return json({ ok:true,data });
    } catch { return json({ ok:false,error:"Permintaan tidak dapat diproses" },400); }
  };
}
