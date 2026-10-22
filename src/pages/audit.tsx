import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ScrollText } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { AUDIT_PAGE_SIZE, searchAudit } from "@/lib/audit-search";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";

export function AuditPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(q); setPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const searchKey = JSON.stringify([query, from, to, page]);
  const loadedResult = useLiveQuery(
    async () => ({ ...await searchAudit({ query, from, to, page }), key: searchKey }),
    [query, from, to, page],
  );
  const result = loadedResult?.key === searchKey ? loadedResult : undefined;
  const invalidDates = !!from && !!to && from > to;
  const searching = q !== query;
  const filtered = !searching ? result?.entries : undefined;

  return (
    <>
      <PageHeader title="Audit Log" />
      <PageBody>
        <Input
          aria-label="Cari seluruh riwayat aktivitas"
          placeholder="Cari aktivitas / nama…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dari tanggal"><Input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(0); }} /></Field>
          <Field label="Sampai tanggal"><Input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(0); }} /></Field>
        </div>
        {invalidDates && <p role="alert" className="text-sm text-red-600">Tanggal awal harus sebelum atau sama dengan tanggal akhir.</p>}
        <p className="text-xs text-slate-400">
          Pencarian mencakup seluruh riwayat yang tersedia di perangkat ini. Aktivitas terbaru tampil lebih dulu, {AUDIT_PAGE_SIZE} per halaman. Tanggal mengikuti WITA.
        </p>
        {(result === undefined || searching) && <p role="status" className="text-sm text-slate-500">Mencari aktivitas…</p>}
        {!searching && filtered?.length === 0 && !invalidDates && (
          <EmptyState icon={<ScrollText />} title={query || from || to ? "Tidak ada aktivitas yang cocok" : "Belum ada aktivitas"} />
        )}
        <div className="space-y-2">
          {filtered?.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{e.userName}</span>
                <Tag>{e.entity}</Tag>
                <span className="ml-auto text-xs text-slate-400">
                  {fmtDateTime(e.at)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">{e.summary}</p>
            </div>
          ))}
        </div>
        {result && !searching && !invalidDates && (page > 0 || result.entries.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500" role="status">Halaman {page + 1}{result.entries.length > 0 ? ` · aktivitas ${page * AUDIT_PAGE_SIZE + 1}–${page * AUDIT_PAGE_SIZE + result.entries.length}` : " · tidak ada aktivitas"}{result.hasMore ? " · masih ada hasil berikutnya" : " · akhir hasil"}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Sebelumnya</Button>
              <Button variant="outline" size="sm" disabled={!result.hasMore} onClick={() => setPage((value) => value + 1)}>Berikutnya</Button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
