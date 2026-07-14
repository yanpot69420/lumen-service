import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, Wrench } from "lucide-react";
import { db } from "@/db/db";
import { TICKET_STATUSES, type TicketStatus } from "@/db/types";
import { ticketTotal } from "@/db/tickets";
import { rp, fmtDate } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  TicketStatusTag,
  TICKET_STATUS_LABEL,
} from "@/components/ui/status-tag";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

const FILTERS: (TicketStatus | "aktif" | "semua")[] = [
  "aktif",
  ...TICKET_STATUSES,
  "semua",
];

export function ServisListPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("aktif");
  const tickets = useLiveQuery(
    () => db.tickets.orderBy("createdAt").reverse().toArray(),
    [],
  );

  const filtered = tickets?.filter((t) => {
    if (filter === "aktif" && (t.status === "diambil" || t.status === "batal"))
      return false;
    if (filter !== "aktif" && filter !== "semua" && t.status !== filter)
      return false;
    if (q) {
      const s = `${t.noNota} ${t.customerName} ${t.brand} ${t.model} ${t.phone}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Servis"
        action={
          <Link
            to="/app/servis/baru"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent-500 px-3 text-xs font-semibold text-brand-950 hover:bg-accent-400"
          >
            <Plus className="size-4" /> Nota Baru
          </Link>
        }
      />
      <PageBody>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Cari nota / nama / tipe HP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-brand-950 text-white"
                  : "bg-white text-slate-600 border border-slate-200",
              )}
            >
              {f === "aktif"
                ? "Aktif"
                : f === "semua"
                  ? "Semua"
                  : TICKET_STATUS_LABEL[f]}
            </button>
          ))}
        </div>

        {filtered?.length === 0 && (
          <EmptyState
            icon={<Wrench />}
            title="Belum ada nota servis"
            hint="Tekan “Nota Baru” saat pelanggan datang."
          />
        )}
        <div className="space-y-2">
          {filtered?.map((t) => (
            <Link
              key={t.id}
              to={`/app/servis/${t.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-300"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-brand-600">
                    {t.noNota}
                  </span>
                  <TicketStatusTag status={t.status} />
                </div>
                <p className="mt-1 truncate text-sm font-semibold">
                  {t.brand} {t.model}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {t.customerName} · {t.keluhan}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold tabular-nums">
                  {rp(ticketTotal(t))}
                </p>
                <p className="text-xs text-slate-400">{fmtDate(t.createdAt)}</p>
              </div>
            </Link>
          ))}
        </div>
      </PageBody>
    </>
  );
}
