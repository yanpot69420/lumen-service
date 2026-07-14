import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { db } from "@/db/db";
import type { Ticket } from "@/db/types";
import { ticketSisa, ticketTotal } from "@/db/tickets";
import { rp, fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TicketStatusTag } from "@/components/ui/status-tag";
import { Row } from "@/components/ui/misc";
import { PublicFooter, PublicNav } from "./landing";

export function CekStatusPage() {
  const [params] = useSearchParams();
  const [nota, setNota] = useState(params.get("nota") ?? "");
  const [result, setResult] = useState<Ticket | null | "notfound">(null);
  const [busy, setBusy] = useState(false);

  async function cari(no: string) {
    const clean = no.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    const t = await db.tickets.where("noNota").equals(clean).first();
    setResult(t ?? "notfound");
    setBusy(false);
  }

  useEffect(() => {
    if (params.get("nota")) cari(params.get("nota")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <PublicNav active="cek" />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <b>Segera aktif.</b> Cek status online sedang disiapkan — untuk saat
          ini silakan tanyakan status servis Anda via WhatsApp konter dengan
          menyebutkan nomor nota.
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold">Cek Status Servis</h1>
          <p className="mt-1 text-sm text-slate-500">
            Masukkan nomor nota yang tertera di nota servis Anda.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="LS-2607-0001"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cari(nota)}
            className="font-mono uppercase"
          />
          <Button disabled={busy || !nota.trim()} onClick={() => cari(nota)}>
            <Search /> Cek
          </Button>
        </div>

        {result === "notfound" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">
            Nota tidak ditemukan. Periksa kembali nomornya, atau hubungi konter.
          </div>
        )}

        {result && result !== "notfound" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-xs font-semibold text-brand-600">
                  {result.noNota}
                </p>
                <p className="mt-1 font-bold">
                  {result.brand} {result.model}
                </p>
                <p className="text-sm text-slate-500">{result.keluhan}</p>
              </div>
              <TicketStatusTag status={result.status} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-2">
              <Row label={result.biayaJasa ? "Biaya" : "Estimasi biaya"}>
                {rp(ticketTotal(result))}
              </Row>
              {result.dp > 0 && (
                <>
                  <Row label="DP dibayar">{rp(result.dp)}</Row>
                  <Row label="Sisa saat pengambilan" strong>
                    {rp(ticketSisa(result))}
                  </Row>
                </>
              )}
            </div>
            <ol className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {[...result.history].reverse().map((h, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <div className="size-2 shrink-0 rounded-full bg-brand-500" />
                  <TicketStatusTag status={h.status} />
                  <span className="ml-auto text-xs text-slate-400">
                    {fmtDateTime(h.at)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
