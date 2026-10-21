import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Row } from "@/components/ui/misc";
import { TicketStatusTag } from "@/components/ui/status-tag";
import { findPublicStatus } from "@/db/public";
import { isCloud } from "@/db/supabase";
import { fmtDateTime, rp } from "@/lib/format";
import { createPublicStatusLookup, emptyStatusLookup, type PublicStatusLookupState } from "@/lib/public-status-lookup";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PublicFooter, PublicNav } from "./landing";

export function CekStatusPage() {
  const [params] = useSearchParams();
  const [nota, setNota] = useState(params.get("nota") ?? "");
  const [suffix, setSuffix] = useState("");
  const [{ result, busy, error }, setLookupState] = useState<PublicStatusLookupState>(emptyStatusLookup);
  const [lookup] = useState(() => createPublicStatusLookup(findPublicStatus, setLookupState));
  useEffect(() => () => lookup.cancel(), [lookup]);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <PublicNav active="cek" />
      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 py-10">
        {!isCloud && <p className="text-xs text-slate-500">Pratinjau lokal — pencarian memakai data perangkat ini.</p>}
        {error && <p role="alert" className="rounded-xl bg-accent-50 p-4 text-sm text-accent-800">{error}</p>}
        <div className="text-center">
          <h1 className="text-xl font-bold">Cek Status Servis</h1>
          <p className="mt-1 text-sm text-slate-500">
            Masukkan nomor nota dan 4 digit terakhir nomor WA yang dicatat saat servis.
          </p>
        </div>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void lookup.search(nota, suffix); }}>
        <Input aria-label="4 digit terakhir nomor WA pelanggan" placeholder="4 digit terakhir nomor WA" inputMode="numeric" maxLength={4} value={suffix} onChange={(e) => { lookup.clear(); setSuffix(e.target.value.replace(/\D/g, "")); }} />
        <div className="flex gap-2">
          <Input
            aria-label="Nomor nota servis"
            placeholder="Nomor nota servis"
            value={nota}
            onChange={(e) => { lookup.clear(); setNota(e.target.value); }}
            className="font-mono uppercase"
          />
          <Button type="submit" disabled={busy || !nota.trim() || suffix.length !== 4}>
            <Search /> {busy ? "Mencari…" : "Cek"}
          </Button>
        </div>
        </form>

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

              </div>
              <TicketStatusTag status={result.status} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-2">
              <Row label={"Total biaya / estimasi"}>
                {rp(result.total)}
              </Row>
              {result.dp > 0 && (
                <>
                  <Row label="DP dibayar">{rp(result.dp)}</Row>
                </>
              )}
            </div>
            <Row label={result.status === "diambil" ? "Piutang / sisa bayar" : "Sisa bayar"} strong>{rp(result.sisa)}</Row>
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
