import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, Smartphone, MessageCircle } from "lucide-react";
import { db } from "@/db/db";
import { rp } from "@/lib/format";
import { waLink } from "@/lib/wa";
import { Input } from "@/components/ui/field";
import { FirstPhoto } from "@/components/photos";
import { EmptyState } from "@/components/ui/misc";
import { PublicFooter, PublicNav, useStoreProfile } from "./landing";

export function KatalogPage() {
  const store = useStoreProfile();
  const [q, setQ] = useState("");
  const units = useLiveQuery(
    () =>
      db.units
        .where("status")
        .equals("stok")
        .filter((u) => u.hargaJual > 0)
        .reverse()
        .sortBy("boughtAt"),
    [],
  );
  const filtered = units?.filter((u) =>
    q
      ? `${u.brand} ${u.model} ${u.varian}`.toLowerCase().includes(q.toLowerCase())
      : true,
  );

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <PublicNav active="katalog" />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <b>Segera aktif.</b> Katalog online sedang disiapkan — stok terbaru
          bisa ditanyakan langsung via WhatsApp konter.
        </div>
        <div>
          <h1 className="text-xl font-bold">Katalog HP Second</h1>
          <p className="text-sm text-slate-500">
            Semua unit sudah dicek menyeluruh & bergaransi toko.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Cari merk / tipe…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {filtered?.length === 0 && (
          <EmptyState
            icon={<Smartphone />}
            title="Stok sedang kosong"
            hint="Hubungi kami via WA untuk info unit terbaru."
          />
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered?.map((u) => (
            <div
              key={u.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <FirstPhoto refType="unit" refId={u.id} className="aspect-square w-full rounded-none" />
              <div className="flex flex-1 flex-col p-3">
                <p className="text-sm font-semibold">
                  {u.brand} {u.model}
                </p>
                <p className="text-xs text-slate-400">
                  {u.varian}
                  {u.kondisi && ` · ${u.kondisi}`}
                </p>
                <p className="mt-1 text-base font-bold text-brand-600">
                  {rp(u.hargaJual)}
                </p>
                {store.phone && (
                  <a
                    href={waLink(
                      store.phone,
                      `Halo, saya berminat dengan ${u.brand} ${u.model} ${u.varian} (${u.kode}) yang di katalog. Masih ada?`,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-brand-950 text-xs font-semibold text-white hover:bg-brand-900"
                  >
                    <MessageCircle className="size-3.5" /> Tanya via WA
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
