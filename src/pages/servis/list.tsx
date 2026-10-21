import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUpRight, ChevronRight, Plus, Search, Smartphone, Wrench } from "lucide-react";
import { db } from "@/db/db";
import { TICKET_STATUSES, type TicketStatus } from "@/db/types";
import { ticketTotal } from "@/db/tickets";
import { rp, fmtDate } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Input } from "@/components/ui/field";
import {
  TicketStatusTag,
  TICKET_STATUS_LABEL,
} from "@/components/ui/status-tag";
import { EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

const FILTERS: (TicketStatus | "aktif" | "semua" | "piutang")[] = [
  "aktif",
  ...TICKET_STATUSES,
  "piutang",
  "semua",
];
const filterLabel = (filter: (typeof FILTERS)[number]) => filter === "aktif" ? "Aktif" : filter === "semua" ? "Semua" : filter === "piutang" ? "Piutang" : TICKET_STATUS_LABEL[filter];

export function ServisListPage() {
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const requestedFilter = params.get("status");
  const filter = FILTERS.includes(requestedFilter as (typeof FILTERS)[number]) ? requestedFilter as (typeof FILTERS)[number] : "aktif";
  const filterBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = filterBar.current;
    const active = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (bar && active && window.matchMedia("(max-width: 1023px)").matches) {
      bar.scrollLeft += active.getBoundingClientRect().left - bar.getBoundingClientRect().left - (bar.clientWidth - active.offsetWidth) / 2;
    }
  }, [filter]);
  function setFilter(value: (typeof FILTERS)[number]) {
    const next = new URLSearchParams(params);
    next.set("status", value);
    setParams(next, { replace: true });
  }
  const tickets = useLiveQuery(
    () => db.tickets.orderBy("createdAt").reverse().toArray(),
    [],
  );

  const filtered = tickets?.filter((t) => {
    if (filter === "aktif" && (t.status === "diambil" || t.status === "batal"))
      return false;
    if (filter === "piutang" && (t.piutang ?? 0) <= 0) return false;
    if (filter !== "aktif" && filter !== "semua" && filter !== "piutang" && t.status !== filter)
      return false;
    if (q) {
      const s = `${t.noNota} ${t.customerName} ${t.brand} ${t.model} ${t.phone}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const activeCount = tickets?.filter((t) => t.status !== "diambil" && t.status !== "batal").length ?? 0;
  const readyCount = tickets?.filter((t) => t.status === "selesai").length ?? 0;
  const checkingCount = tickets?.filter((t) => t.status === "masuk").length ?? 0;

  return (
    <>
      <PageHeader
        title="Servis"
        action={
          <Link
            to="/app/servis/baru"
            className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-accent-500 px-4 text-sm font-semibold text-brand-950 hover:bg-accent-400 lg:h-8 lg:rounded-xl lg:px-3 lg:text-xs"
          >
            <Plus className="size-4" /> Nota Baru
          </Link>
        }
      />
      <PageBody>
        <section className="overflow-hidden rounded-[1.75rem] bg-brand-950 p-5 text-white lg:hidden" aria-label="Ringkasan antrean servis">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Meja servis</p>
              <h2 className="mt-2 text-[1.45rem] font-bold leading-tight">Antrean perangkat</h2>
            </div>
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-accent-400"><Wrench className="size-5" /></span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {([
              { value: activeCount, label: "Aktif", filter: "aktif" },
              { value: checkingCount, label: "Perlu dicek", filter: "masuk" },
              { value: readyCount, label: "Siap diambil", filter: "selesai" },
            ] as const).map((item) => (
              <button key={item.label} type="button" onClick={() => setFilter(item.filter)} className="min-h-20 rounded-2xl bg-white/[0.07] px-3 py-3 text-left transition-colors active:bg-white/15">
                <span className="block text-2xl font-bold tabular-nums text-accent-400">{item.value}</span>
                <span className="mt-1 block text-[11px] font-medium text-white/70">{item.label}</span>
              </button>
            ))}
          </div>
        </section>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-12 rounded-2xl border-transparent pl-10 shadow-sm lg:h-11 lg:rounded-xl lg:border-slate-300 lg:pl-9 lg:shadow-none"
            aria-label="Cari nota servis"
            placeholder="Cari nota / nama / tipe HP…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div ref={filterBar} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:gap-1.5 lg:px-0" aria-label="Filter status servis">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "min-h-11 shrink-0 rounded-2xl px-4 py-2 text-xs font-semibold capitalize transition-colors lg:min-h-0 lg:rounded-full lg:px-3 lg:py-1.5 lg:font-medium",
                filter === f
                  ? "bg-brand-950 text-white"
                  : "bg-white text-slate-600 border border-slate-200",
              )}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between lg:hidden">
          <h2 className="text-sm font-bold text-brand-950">{filter === "aktif" ? "Antrean aktif" : filter === "semua" ? "Semua nota" : filterLabel(filter)}</h2>
          <span className="text-xs text-slate-500">{filtered?.length ?? 0} perangkat</span>
        </div>

        {filtered?.length === 0 && (
          <EmptyState
            icon={<Wrench />}
            title="Belum ada nota servis"
            hint="Tekan “Nota Baru” saat pelanggan datang."
          />
        )}
        <div className="space-y-3 lg:space-y-2">
          {filtered?.map((t) => (
            <Link
              key={t.id}
              to={`/app/servis/${t.id}`}
              className="group block overflow-hidden rounded-[1.5rem] border border-white bg-white p-4 shadow-[0_2px_10px_rgba(15,23,42,0.025)] transition-colors hover:border-brand-300 lg:flex lg:items-center lg:gap-3 lg:rounded-2xl lg:border-slate-200 lg:shadow-none"
            >
              <div className="flex items-start gap-3 lg:hidden">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#f4f5f0] text-brand-700"><Smartphone className="size-6" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-brand-950">{t.brand} {t.model}</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">{t.customerName}</p>
                </div>
                <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 lg:hidden">
                <TicketStatusTag status={t.status} />
                <span className="font-mono text-[10px] tracking-wide text-slate-400">{t.noNota}</span>
              </div>
              <p className="mt-3 truncate text-xs leading-relaxed text-slate-500 lg:hidden">{t.keluhan}</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 lg:hidden">
                <span className="text-[11px] text-slate-400">{fmtDate(t.createdAt)}</span>
                <span className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums text-brand-950">{rp(ticketTotal(t))}<ArrowUpRight className="size-3.5 text-slate-400" /></span>
              </div>
              <div className="hidden min-w-0 flex-1 lg:block">
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
              <div className="hidden text-right lg:block">
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
