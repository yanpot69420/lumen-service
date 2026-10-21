import { can } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Tag, TicketStatusTag } from "@/components/ui/status-tag";
import { customerTickets } from "@/db/customers";
import { db } from "@/db/db";
import { ticketTotal } from "@/db/tickets";
import { fmtDate, rp } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChevronRight, Pencil, Plus, Star, Wrench } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CustomerForm } from "./customer-form";

export function PelangganDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const [editOpen, setEditOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const result = useLiveQuery(async () => {
    try {
      const [customer, customers, tickets] = await Promise.all([
        db.customers.get(id!),
        db.customers.toArray(),
        db.tickets.toArray(),
      ]);
      return { customer: customer ?? null, customers, tickets, error: "" };
    } catch {
      return { customer: null, customers: [], tickets: [], error: "Profil pelanggan belum berhasil dimuat." };
    }
  }, [id, retry]);
  const customer = result?.customer;
  const tickets = customer && result ? customerTickets(customer, result.tickets, result.customers) : [];
  const active = tickets.filter((ticket) => ticket.status !== "diambil" && ticket.status !== "batal").length;

  const back = <Link to="/app/pelanggan" aria-label="Kembali ke daftar pelanggan" className="flex size-11 items-center justify-center rounded-2xl bg-white text-slate-500 hover:text-slate-600 lg:size-auto lg:bg-transparent lg:text-slate-400"><ArrowLeft className="size-5" /></Link>;

  return (
    <>
      <PageHeader
        title={customer?.name ?? "Profil Pelanggan"}
        back={back}
        action={customer && can(user.role, "customers") ? (
          <Button variant="outline" size="sm" className="h-11 rounded-2xl lg:h-8 lg:rounded-xl" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
        ) : undefined}
      />
      <PageBody>
        {result === undefined ? <p role="status" className="py-8 text-center text-sm text-slate-500">Memuat profil pelanggan…</p>
          : result.error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p>{result.error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setRetry((value) => value + 1)}>Coba lagi</Button>
          </div>
          : !customer ? <EmptyState title="Pelanggan tidak ditemukan" action={<Link to="/app/pelanggan" className="text-sm font-medium text-brand-600 underline">Kembali ke daftar pelanggan</Link>} />
          : <>
            <div className="rounded-[28px] border border-brand-950 bg-brand-950 p-5 text-white lg:rounded-2xl lg:border-slate-200 lg:bg-white lg:text-slate-900">
              <div className="flex flex-col items-center gap-3 text-center lg:flex-row lg:items-start lg:text-left">
                <div aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-[26px] bg-accent-500 text-2xl font-bold text-brand-950 lg:size-12 lg:rounded-full lg:bg-brand-50 lg:text-xl lg:text-brand-700">{customer.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</div>
                <div className="min-w-0 w-full flex-1">
                  <h2 className="break-words text-2xl font-bold lg:text-lg">{customer.name}</h2>
                  <p className="mt-1 text-sm text-white/60 lg:mt-0.5 lg:text-slate-500">{customer.phone || "Tanpa nomor WhatsApp"}</p>
                  {customer.isRegular && <Tag className="mt-2 gap-1 bg-amber-100 text-amber-800"><Star className="size-3" /> Pelanggan langganan</Tag>}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-5 text-center text-sm lg:mt-4 lg:gap-3 lg:border-slate-100 lg:pt-4 lg:text-left">
                <div><p className="text-[11px] text-white/60 lg:text-xs lg:text-slate-500">Jumlah servis</p><p className="mt-1 text-2xl font-bold tabular-nums lg:text-sm">{tickets.length}</p></div>
                <div><p className="text-[11px] text-white/60 lg:text-xs lg:text-slate-500">Servis aktif</p><p className="mt-1 text-2xl font-bold tabular-nums text-accent-400 lg:text-sm lg:text-slate-900">{active}</p></div>
                <div><p className="text-[11px] text-white/60 lg:text-xs lg:text-slate-500">Terakhir datang</p><p className="mt-2 text-xs font-semibold lg:mt-1">{tickets[0] ? fmtDate(tickets[0].createdAt) : "—"}</p></div>
              </div>
              {customer.notes && <div className="mt-5 rounded-2xl bg-white/10 p-4 lg:mt-4 lg:rounded-xl lg:bg-slate-50 lg:p-3">
                <h3 className="text-xs font-semibold text-white/50 lg:text-slate-500">Catatan pelanggan</h3>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90 lg:text-slate-700">{customer.notes}</p>
              </div>}
              <p className="mt-4 text-center text-xs text-white/40 lg:text-left lg:text-slate-400">Terdaftar {fmtDate(customer.createdAt)}</p>
              {can(user.role, "service") && <Link
                to={`/app/servis/baru?customer=${encodeURIComponent(customer.id)}`}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 px-4 text-sm font-semibold text-brand-950 hover:bg-accent-400 lg:mt-4 lg:h-10 lg:w-auto lg:rounded-xl"
              ><Plus className="size-4" /> Buat Nota</Link>}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 pt-2 lg:pt-0"><h2 className="text-base font-bold lg:text-sm">Riwayat Servis</h2><span className="text-xs text-slate-400 lg:hidden">{tickets.length} nota</span></div>
              {tickets.length === 0 ? <EmptyState icon={<Wrench />} title="Belum ada riwayat servis" hint="Nota yang dibuat dengan profil ini akan tampil di sini." />
                : tickets.map((ticket) => <Link
                  key={ticket.id}
                  to={`/app/servis/${ticket.id}`}
                  className="block rounded-3xl border border-white bg-white p-4 shadow-sm hover:border-brand-300 lg:rounded-2xl lg:border-slate-200 lg:shadow-none"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[11px] font-semibold text-slate-400 lg:text-xs lg:text-brand-600">{ticket.noNota}</p>
                    <TicketStatusTag status={ticket.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold lg:text-sm">{ticket.brand} {ticket.model}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 lg:mt-0.5 lg:truncate">{ticket.keluhan}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 lg:mt-3 lg:pt-2">
                    <span>{fmtDate(ticket.createdAt)}</span>
                    <span className="font-semibold tabular-nums text-slate-700">{ticket.hargaFinal || ticket.biayaJasa > 0 ? rp(ticketTotal(ticket)) : "Harga belum ditetapkan"}</span>
                  </div>
                </Link>)}
              <p className="text-xs text-slate-400">Riwayat lama dicocokkan jika identitas pelanggan dapat dipastikan. Data pada nota lama tetap mengikuti saat nota dibuat.</p>
            </div>
          </>}
      </PageBody>
      {editOpen && customer && <CustomerForm customer={customer} onClose={() => setEditOpen(false)} onSaved={() => setEditOpen(false)} />}
    </>
  );
}
