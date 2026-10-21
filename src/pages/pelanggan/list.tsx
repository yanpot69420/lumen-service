import { can } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";
import { customerTickets } from "@/db/customers";
import { db } from "@/db/db";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Plus, Search, Star, Users, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CustomerForm } from "./customer-form";

export function PelangganListPage() {
  const user = useUser();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"semua" | "langganan">("semua");
  const [formOpen, setFormOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      const [customers, tickets] = await Promise.all([
        db.customers.orderBy("name").toArray(),
        db.tickets.toArray(),
      ]);
      return { customers, tickets, error: "" };
    } catch {
      return { customers: [], tickets: [], error: "Data pelanggan belum berhasil dimuat." };
    }
  }, [retry]);
  const customers = result?.error ? undefined : result?.customers;
  const entries = useMemo(() => {
    if (!customers || !result) return [];
    return customers.map((customer) => {
      const history = customerTickets(customer, result.tickets, customers);
      return {
        customer,
        count: history.length,
        lastVisit: history.reduce((last, ticket) => Math.max(last, ticket.createdAt), 0),
      };
    });
  }, [customers, result]);
  const text = query.trim().toLocaleLowerCase("id-ID");
  const digits = query.replace(/\D/g, "").replace(/^0/, "62");
  const filtered = entries.filter(({ customer }) => {
    if (filter === "langganan" && !customer.isRegular) return false;
    return !text || customer.name.toLocaleLowerCase("id-ID").includes(text)
      || customer.phone.includes(text)
      || (!!digits && customer.phoneNormalized.includes(digits));
  });
  const regularCount = customers?.filter((customer) => customer.isRegular).length ?? 0;

  return (
    <>
      <PageHeader
        title="Pelanggan"
        subtitle="Kontak pelanggan dan riwayat servis yang mudah ditelusuri."
        action={can(user.role, "customers") ? (
          <Button variant="accent" size="sm" className="h-11 rounded-2xl lg:h-11 lg:px-5" onClick={() => setFormOpen(true)}><Plus /> Tambah<span className="hidden lg:inline">pelanggan</span></Button>
        ) : undefined}
      />
      <PageBody>
        <div className="rounded-3xl bg-brand-950 p-5 text-white lg:hidden">
          <div className="flex items-start justify-between"><div><p className="text-xs font-medium text-white/60">BUKU PELANGGAN</p><h2 className="mt-2 text-xl font-semibold">Kenal lebih dekat.</h2><p className="mt-1 text-xs leading-relaxed text-white/60">Kontak dan riwayat servis dalam satu tempat.</p></div><Users className="mt-1 size-6 shrink-0 text-accent-400" /></div>
          <div className="mt-5 flex gap-6 border-t border-white/10 pt-4"><div><p className="text-2xl font-bold tabular-nums">{customers ? customers.length : "—"}</p><p className="mt-0.5 text-xs text-white/60">Pelanggan</p></div><div className="border-l border-white/10 pl-6"><p className="flex items-center gap-2 text-2xl font-bold tabular-nums text-accent-400">{customers ? regularCount : "—"}<Star className="size-4" /></p><p className="mt-0.5 text-xs text-white/60">Langganan</p></div></div>
        </div>
        <div className="hidden grid-cols-3 gap-4 lg:grid">
          <div className="rounded-[22px] bg-brand-950 p-6 text-white">
            <p className="flex items-center gap-2 text-sm text-white/65"><Users className="size-4 text-accent-400" /> Semua pelanggan</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{customers ? customers.length : "—"}</p>
            <p className="mt-2 text-xs text-white/50">Kontak yang tersimpan di buku pelanggan</p>
          </div>
          <div className="rounded-[22px] border border-accent-200/70 bg-accent-50 p-6">
            <p className="flex items-center gap-2 text-sm text-accent-900/70"><Star className="size-4" /> Pelanggan langganan</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-brand-950">{customers ? regularCount : "—"}</p>
            <p className="mt-2 text-xs text-accent-900/60">Pelanggan yang ditandai sebagai langganan</p>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-6">
            <p className="flex items-center gap-2 text-sm text-slate-500"><Wrench className="size-4 text-brand-600" /> Pernah servis</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-brand-950">{customers ? entries.filter(({ count }) => count > 0).length : "—"}</p>
            <p className="mt-2 text-xs text-slate-400">Pelanggan dengan riwayat nota servis</p>
          </div>
        </div>
        <div className="space-y-4 lg:flex lg:items-center lg:justify-between lg:gap-5 lg:space-y-0 lg:rounded-[22px] lg:border lg:border-slate-200 lg:bg-white lg:p-4">
        <div className="relative lg:w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Cari pelanggan berdasarkan nama atau nomor WhatsApp"
            placeholder="Cari nama atau nomor WhatsApp…"
            className="h-12 rounded-2xl border-transparent bg-white pl-10 shadow-sm lg:h-11 lg:rounded-xl lg:border-slate-200 lg:bg-slate-50 lg:shadow-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-[22px] bg-slate-200 p-1.5 lg:flex lg:gap-2 lg:rounded-none lg:bg-transparent lg:p-0" role="group" aria-label="Filter pelanggan">
          {([['semua', 'Semua'], ['langganan', 'Langganan']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn("flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border px-4 py-2 text-sm font-semibold lg:rounded-xl", filter === value
                ? "border-brand-950 bg-brand-950 text-white" : "border-transparent text-slate-500 hover:border-brand-300 lg:border-slate-200 lg:bg-white")}
            >{value === "langganan" && <Star className="size-3.5" />}{label}</button>
          ))}
        </div>
        </div>
        {result === undefined ? <p role="status" className="py-8 text-center text-sm text-slate-500">Memuat pelanggan…</p>
          : result.error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>{result.error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setRetry((value) => value + 1)}>Coba lagi</Button>
          </div>
          : filtered.length === 0 ? <EmptyState
            icon={<Users />}
            title={customers?.length === 0 ? "Belum ada pelanggan" : "Pelanggan tidak ditemukan"}
            hint={customers?.length === 0 ? "Tambahkan profil pelanggan, lalu riwayat servisnya akan terkumpul di sini." : "Coba nama, nomor WhatsApp, atau filter lain."}
            action={customers?.length === 0 && can(user.role, "customers")
              ? <Button variant="accent" onClick={() => setFormOpen(true)}><Plus /> Tambah Pelanggan</Button>
              : customers?.length ? <Button variant="outline" onClick={() => { setQuery(""); setFilter("semua"); }}>Reset pencarian</Button> : undefined}
          /> : <div className="space-y-3 lg:space-y-0 lg:overflow-hidden lg:rounded-[22px] lg:border lg:border-slate-200 lg:bg-white">
            <div className="lg:flex lg:items-center lg:justify-between lg:border-b lg:border-slate-100 lg:px-6 lg:py-5"><h2 className="hidden text-base font-semibold text-brand-950 lg:block">Buku pelanggan</h2><p role="status" className="text-xs text-slate-500">{filtered.length} pelanggan{query && <span className="hidden lg:inline"> ditemukan</span>}</p></div>
            <div aria-hidden className="hidden grid-cols-[48px_minmax(0,1fr)_110px_80px_145px_16px] items-center gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid"><span className="col-span-2">Pelanggan</span><span>Status</span><span>Servis</span><span>Kunjungan terakhir</span><span /></div>
            {filtered.map(({ customer, count, lastVisit }) => (
              <Link
                key={customer.id}
                to={`/app/pelanggan/${customer.id}`}
                className="grid grid-cols-[48px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-3 rounded-3xl border border-white bg-white p-4 shadow-sm hover:border-brand-300 lg:grid-cols-[48px_minmax(0,1fr)_110px_80px_145px_16px] lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:border-slate-100 lg:px-6 lg:py-5 lg:shadow-none lg:last:border-b-0 lg:hover:bg-brand-50/50"
              >
                <div aria-hidden className={cn("relative flex size-12 shrink-0 items-center justify-center rounded-2xl text-base font-bold", customer.isRegular ? "bg-accent-100 text-accent-900" : "bg-slate-100 text-brand-800")}>
                  {customer.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}
                  {customer.isRegular && <span className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-accent-500 p-1 text-brand-950 lg:hidden"><Star className="size-2.5 fill-current" /></span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-base font-semibold leading-snug lg:truncate lg:text-sm">{customer.name}</p>
                    {customer.isRegular && <span className="sr-only lg:hidden">Pelanggan langganan</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500 lg:mt-0.5">{customer.phone || "Tanpa nomor WhatsApp"}</p>
                </div>
                <div className="hidden lg:block">{customer.isRegular ? <Tag className="gap-1 bg-accent-100 text-accent-800"><Star className="size-3" /> Langganan</Tag> : <span className="text-xs text-slate-400">Reguler</span>}</div>
                <p className="hidden text-sm font-semibold tabular-nums text-brand-950 lg:block">{count}<span className="ml-1 text-xs font-normal text-slate-400">nota</span></p>
                <p className="hidden text-xs text-slate-500 lg:block">{lastVisit ? fmtDate(lastVisit) : "Belum pernah servis"}</p>
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
                <div className="col-span-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs lg:hidden"><span className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-600">{count} servis</span><span className="text-right text-slate-400">{lastVisit ? `Terakhir ${fmtDate(lastVisit)}` : "Belum pernah servis"}</span></div>
              </Link>
            ))}
          </div>}
      </PageBody>
      {formOpen && <CustomerForm onClose={() => setFormOpen(false)} onSaved={(customer) => {
        setFormOpen(false);
        navigate(`/app/pelanggan/${customer.id}`);
      }} />}
    </>
  );
}
