import { can, canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { MethodPicker } from "@/components/method-picker";
import { FirstPhoto } from "@/components/photos";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, RpInput, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { Tag, UnitStatusTag } from "@/components/ui/status-tag";
import { useToast } from "@/components/ui/toast";
import { db } from "@/db/db";
import { adjustPart as adjustPartStock, restockPart, savePart, sellPart } from "@/db/parts";
import type { CashMethod, Part } from "@/db/types";
import { cn } from "@/lib/cn";
import { daysSince, rp } from "@/lib/format";
import { PART_BRANDS, getPartBrand } from "@/lib/part-brands";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Package,
  PackagePlus,
  ChevronRight,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

type StockFilter = "semua" | "tersedia" | "menipis" | "habis" | "perlu-restok";

export function StokPage() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "part" ? "part" : "unit";
  function setTab(value: "unit" | "part") {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", value);
      return next;
    }, { replace: true });
  }
  return (
    <>
      <PageHeader
        title="Stok"
        subtitle="Kelola etalase unit, ketersediaan sparepart, dan kebutuhan restok."
        action={
          tab === "unit" && canSeeMoney(user.role) ? (
            <Link
              to="/app/stok/beli"
              className="inline-flex h-11 items-center gap-1.5 rounded-2xl bg-accent-500 px-3 text-xs font-semibold text-brand-950 hover:bg-accent-400 lg:rounded-xl lg:px-4 lg:text-sm"
            >
              <Plus className="size-4" /> Beli Unit
            </Link>
          ) : undefined
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 gap-1 rounded-[22px] bg-slate-200 p-1.5 text-sm font-semibold lg:w-fit lg:min-w-[430px] lg:rounded-2xl lg:p-1.5" role="group" aria-label="Jenis stok">
          {(
            [
              ["unit", "Unit HP"],
              ["part", "Sparepart & Aksesoris"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "flex min-h-12 items-center justify-center gap-2 rounded-2xl px-2 py-2 transition-colors lg:min-h-11 lg:rounded-xl lg:px-5",
                tab === k ? "bg-brand-950 text-white shadow-sm" : "text-slate-500 hover:text-brand-950",
              )}
              aria-pressed={tab === k}
            >
              {k === "unit" ? <Smartphone className="size-4" /> : <Package className="size-4" />}
              <span className="lg:hidden">{k === "unit" ? "Unit HP" : "Sparepart"}</span><span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
        {tab === "unit" ? <UnitTab /> : <PartTab />}
      </PageBody>
    </>
  );
}

function UnitTab() {
  const user = useUser();
  const money = canSeeMoney(user.role);
  const tableColumns = money
    ? "lg:min-w-[720px] lg:grid-cols-[56px_minmax(0,1fr)_100px_120px_130px_16px]"
    : "lg:grid-cols-[56px_minmax(0,1fr)_110px_150px_16px]";
  const [q, setQ] = useState("");
  const [showSold, setShowSold] = useState(false);
  const units = useLiveQuery(
    () => db.units.orderBy("boughtAt").reverse().toArray(),
    [],
  );
  const filtered = units?.filter((u) => {
    if (!showSold && u.status !== "stok") return false;
    if (q) {
      const s = `${u.kode} ${u.brand} ${u.model} ${u.varian} ${u.imei}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });
  const nilaiStok =
    units
      ?.filter((u) => u.status === "stok")
      .reduce((s, u) => s + u.hargaBeli, 0) ?? 0;
  const availableCount = units?.filter((unit) => unit.status === "stok").length ?? 0;

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="overflow-hidden rounded-3xl bg-brand-950 p-5 text-white lg:hidden">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-xs font-medium text-white/60">ETALASE UNIT</p><p className="mt-2 text-3xl font-bold tabular-nums">{units ? availableCount : "—"}<span className="ml-2 text-sm font-medium text-white/70">HP tersedia</span></p></div>
          <span className="rounded-2xl bg-white/10 p-3 text-accent-400"><Smartphone className="size-6" /></span>
        </div>
        {money && <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4"><div><p className="text-xs text-white/60">Nilai modal stok</p><p className="mt-1 text-base font-semibold tabular-nums">{rp(nilaiStok)}</p></div><button onClick={() => setShowSold((v) => !v)} aria-pressed={showSold} className="min-h-11 rounded-2xl bg-white/10 px-3 text-xs font-medium">{showSold ? "Hanya tersedia" : "Lihat terjual"}</button></div>}
      </div>
      <section className="hidden grid-cols-3 gap-4 lg:grid" aria-label="Ringkasan stok unit desktop">
        <div className="rounded-[22px] bg-brand-950 p-5 text-white"><p className="text-xs text-white/60">Unit tersedia</p><p className="mt-3 text-3xl font-bold tabular-nums text-accent-400">{units ? availableCount : "—"}<span className="ml-2 text-xs font-medium text-white/50">HP</span></p><p className="mt-2 text-xs text-white/45">Siap ditawarkan ke pelanggan</p></div>
        <div className="rounded-[22px] border border-slate-200/80 bg-white p-5"><p className="text-xs text-slate-500">{money ? "Nilai modal stok" : "Total unit tercatat"}</p><p className="mt-3 text-2xl font-bold tabular-nums text-brand-950">{money ? rp(nilaiStok) : units?.length ?? "—"}</p><p className="mt-2 text-xs text-slate-400">{money ? "Modal pada unit yang tersedia" : "Termasuk riwayat unit terjual"}</p></div>
        <div className="rounded-[22px] border border-slate-200/80 bg-white p-5"><p className="text-xs text-slate-500">Stok lebih dari 60 hari</p><p className="mt-3 text-3xl font-bold tabular-nums text-brand-950">{units?.filter((unit) => unit.status === "stok" && daysSince(unit.boughtAt) > 60).length ?? "—"}</p><p className="mt-2 text-xs text-slate-400">Prioritaskan penawaran unit ini</p></div>
      </section>
      <section className="space-y-4 lg:rounded-[22px] lg:border lg:border-slate-200/80 lg:bg-white lg:p-5" aria-label="Cari unit stok">
      <div className="hidden items-center justify-between gap-3 lg:flex"><div><h2 className="text-base font-bold text-brand-950">Etalase unit HP</h2><p className="mt-1 text-xs text-slate-500">{filtered?.length ?? 0} unit ditampilkan{showSold ? " · termasuk terjual" : " · stok tersedia"}</p></div>{money && <button type="button" onClick={() => setShowSold((v) => !v)} aria-pressed={showSold} className={cn("rounded-xl border px-4 py-2.5 text-xs font-semibold transition-colors", showSold ? "border-brand-950 bg-brand-950 text-white" : "border-slate-200 text-brand-700 hover:border-brand-300")}>{showSold ? "Hanya stok tersedia" : "Tampilkan terjual"}</button>}</div>
      <div className="relative lg:max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="h-12 rounded-2xl border-transparent bg-white pl-10 shadow-sm lg:h-11 lg:rounded-xl lg:border-slate-300 lg:shadow-none"
          placeholder="Cari kode / tipe / IMEI…"
          aria-label="Cari unit berdasarkan kode, tipe, atau IMEI"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      </section>
      {filtered?.length === 0 && (
        <EmptyState
          icon={<Smartphone />}
          title="Belum ada unit di stok"
          hint="Tekan “Beli Unit” saat menerima HP dari penjual."
        />
      )}
      <div className={cn("space-y-4 lg:space-y-0 lg:overflow-x-auto lg:rounded-[22px] lg:border lg:border-slate-200/80 lg:bg-white", !filtered?.length && "hidden")}>
      {!!filtered?.length && <div className={cn("hidden gap-4 border-b border-slate-200/70 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid", tableColumns)}><span className="col-span-2">Perangkat / identitas</span><span>Status</span>{money && <span className="text-right">Harga beli</span>}<span className="text-right">Nilai unit</span><span /></div>}
      {filtered?.map((u) => {
        const umur = daysSince(u.boughtAt);
        return (
          <Link
            key={u.id}
            to={`/app/stok/unit/${u.id}`}
            className={cn("group grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3 gap-y-4 rounded-3xl border border-white bg-white p-4 shadow-sm hover:border-brand-300 lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:border-slate-100 lg:px-5 lg:py-4 lg:shadow-none lg:last:border-b-0 lg:hover:bg-brand-50/50", tableColumns)}
          >
            <FirstPhoto refType="unit" refId={u.id} className="size-16 shrink-0 rounded-2xl lg:size-14" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden font-mono text-xs font-semibold text-brand-600 lg:inline">
                  {u.kode}
                </span>
                <span className="lg:hidden"><UnitStatusTag status={u.status} /></span>
                {u.status === "stok" && umur > 60 && (
                  <Tag className="bg-red-100 text-red-700 lg:hidden">{umur} hari</Tag>
                )}
              </div>
              <p className="mt-1 break-words text-base font-semibold leading-snug lg:mt-1 lg:truncate lg:text-sm lg:text-brand-950">
                {u.brand} {u.model} {u.varian}
              </p>
              <p className="mt-1 truncate text-xs text-slate-400">IMEI {u.imei}</p>
            </div>
            <div className="hidden flex-col items-start gap-2 lg:flex"><UnitStatusTag status={u.status} />{u.status === "stok" && umur > 60 && <span className="text-[11px] font-medium text-red-500">{umur} hari di stok</span>}</div>
            <div className="col-span-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 lg:hidden"><span className="font-mono text-[11px] font-medium text-slate-400">{u.kode}</span><ChevronRight className="size-4 text-slate-300" /></div>
            {money && <p className="hidden whitespace-nowrap text-right text-sm tabular-nums text-slate-600 lg:block">{rp(u.hargaBeli)}</p>}
            <div className="col-span-2 -mt-3 flex items-center justify-between gap-3 text-sm lg:col-span-1 lg:mt-0 lg:block lg:border-0 lg:pt-0 lg:text-right">
              {u.status === "stok" ? (
                <>
                  <p className="font-bold tabular-nums lg:order-none">
                    {u.hargaJual ? rp(u.hargaJual) : "—"}
                  </p>
                  {money && (
                    <p className="text-xs text-slate-400 lg:hidden">Harga beli {rp(u.hargaBeli)}</p>
                  )}
                </>
              ) : money ? (
                <p className="font-bold tabular-nums text-brand-600">
                  +{rp((u.soldPrice ?? 0) - u.hargaBeli)}
                </p>
              ) : (
                <p className="font-bold tabular-nums">{rp(u.soldPrice ?? 0)}</p>
              )}
            </div>
            <ChevronRight className="hidden size-4 text-slate-300 group-hover:text-brand-700 lg:block" />
          </Link>
        );
      })}
      </div>
    </div>
  );
}

function PartTab() {
  const user = useUser();
  const money = canSeeMoney(user.role);
  const tableColumns = money
    ? "lg:min-w-[720px] lg:grid-cols-[minmax(0,1fr)_90px_80px_120px_120px_16px]"
    : "lg:grid-cols-[minmax(0,1fr)_110px_100px_110px_16px]";
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const parts = useLiveQuery(() => db.parts.orderBy("nama").toArray(), []);
  const [editing, setEditing] = useState<Part | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [q, setQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState<"semua" | Part["kategori"]>("semua");
  const [brandFilter, setBrandFilter] = useState("semua");
  const requestedStock = params.get("stock");
  const stock: StockFilter = requestedStock === "tersedia" || requestedStock === "menipis" || requestedStock === "habis" || requestedStock === "perlu-restok" ? requestedStock : "semua";
  function setStock(value: StockFilter) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "semua") next.delete("stock");
      else next.set("stock", value);
      return next;
    }, { replace: true });
  }
  const [sellOpen, setSellOpen] = useState(false);
  const [restokPart, setRestokPart] = useState<Part | null>(null);
  const [adjustPart, setAdjustPart] = useState<Part | null>(null);
  const [f, setF] = useState({
    nama: "",
    brand: "",
    kategori: "sparepart" as Part["kategori"],
    stok: 0,
    hargaModal: 0,
    hargaJual: 0,
    minStok: 1,
  });
  const [sale, setSale] = useState({
    partId: "",
    qty: 1,
    harga: 0,
    method: "tunai" as CashMethod,
  });
  const [busy, setBusy] = useState(false);

  const filterCount = Number(category !== "semua") + Number(stock !== "semua") + Number(brandFilter !== "semua");
  const brandCounts = new Map<string, number>();
  for (const part of parts ?? []) {
    const brand = getPartBrand(part);
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
  }
  const quickBrands = PART_BRANDS;
  const searching = !!q.trim();
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = parts?.filter((part) => {
    const brand = getPartBrand(part);
    if (category !== "semua" && part.kategori !== category) return false;
    if (brandFilter !== "semua" && brand !== brandFilter) return false;
    if (stock === "tersedia" && part.stok <= 0) return false;
    if (stock === "menipis" && (part.stok <= 0 || part.stok > part.minStok)) return false;
    if (stock === "habis" && part.stok !== 0) return false;
    if (stock === "perlu-restok" && part.stok > part.minStok) return false;
    return terms.every((term) => `${part.nama} ${brand}`.toLowerCase().includes(term));
  });

  function resetFilters() {
    setCategory("semua");
    setBrandFilter("semua");
    setStock("semua");
  }

  function openNew() {
    setEditing(null);
    setF({ nama: "", brand: brandFilter !== "semua" ? brandFilter : "", kategori: "sparepart", stok: 0, hargaModal: 0, hargaJual: 0, minStok: 1 });
    setFormOpen(true);
  }
  function openEdit(p: Part) {
    if (!money) return;
    setEditing(p);
    setF({ ...p, brand: getPartBrand(p) });
    setFormOpen(true);
  }

  async function save() {
    if (!f.nama.trim() || !f.brand || busy) return;
    setBusy(true);
    try {
      await savePart(user, f, editing?.id);
      toast("Tersimpan");
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const selPart = parts?.find((p) => p.id === sale.partId);
  const PartRow = money ? "button" : "div";

  async function doSell() {
    if (!selPart || busy) return;
    setBusy(true);
    try {
      await sellPart(user, sale);
      toast("Penjualan tercatat di Kas");
      setSellOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="rounded-3xl bg-brand-950 p-5 text-white lg:hidden">
        <div className="flex items-start justify-between"><div><p className="text-xs font-medium text-white/60">RAK SPAREPART</p><p className="mt-2 text-3xl font-bold tabular-nums">{parts ? parts.length : "—"}<span className="ml-2 text-sm font-medium text-white/70">jenis barang</span></p></div><span className="rounded-2xl bg-white/10 p-3 text-accent-400"><Package className="size-6" /></span></div>
        <div className="mt-5 grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 pt-4 text-sm"><div><p className="text-xs text-white/60">Tersedia</p><p className="mt-1 font-semibold">{parts?.filter((part) => part.stok > 0).length ?? "—"} jenis</p></div><div className="pl-5"><p className="text-xs text-white/60">Perlu restok</p><p className="mt-1 font-semibold text-accent-400">{parts?.filter((part) => part.stok <= part.minStok).length ?? "—"} jenis</p></div></div>
      </div>
      <section className="hidden grid-cols-3 gap-4 lg:grid" aria-label="Ringkasan sparepart desktop">
        <button type="button" onClick={() => setStock("semua")} className="rounded-[22px] bg-brand-950 p-5 text-left text-white"><p className="text-xs text-white/60">Katalog barang</p><p className="mt-3 text-3xl font-bold tabular-nums text-accent-400">{parts?.length ?? "—"}<span className="ml-2 text-xs font-medium text-white/50">jenis</span></p><p className="mt-2 text-xs text-white/45">Sparepart dan aksesoris</p></button>
        <button type="button" onClick={() => setStock("tersedia")} className="rounded-[22px] border border-slate-200/80 bg-white p-5 text-left transition-colors hover:border-brand-300"><p className="text-xs text-slate-500">Barang tersedia</p><p className="mt-3 text-3xl font-bold tabular-nums text-brand-950">{parts?.filter((part) => part.stok > 0).length ?? "—"}</p><p className="mt-2 text-xs text-slate-400">Siap dipakai atau dijual</p></button>
        <button type="button" onClick={() => setStock("perlu-restok")} className="rounded-[22px] border border-accent-200 bg-accent-50 p-5 text-left transition-colors hover:border-accent-400"><p className="text-xs text-brand-700">Perlu restok</p><p className="mt-3 text-3xl font-bold tabular-nums text-brand-950">{parts?.filter((part) => part.stok <= part.minStok).length ?? "—"}</p><p className="mt-2 text-xs text-brand-700/70">Stok menipis atau sudah habis</p></button>
      </section>
      <section className="space-y-4 lg:rounded-[22px] lg:border lg:border-slate-200/80 lg:bg-white lg:p-5" aria-label="Cari dan kelola sparepart">
      <div className="flex gap-2 lg:items-center">
        <div className="mr-auto hidden lg:block"><h2 className="text-base font-bold text-brand-950">Katalog sparepart</h2><p className="mt-1 text-xs text-slate-500">Cari barang berdasarkan nama, tipe, atau merek.</p></div>
        {can(user.role, "sell") && <Button variant="accent" className="h-12 flex-1 rounded-2xl lg:h-11 lg:flex-none lg:rounded-xl" onClick={() => {
          setSale({ partId: "", qty: 1, harga: 0, method: "tunai" });
          setSellOpen(true);
        }}>
          <ShoppingCart /> Jual Cepat
        </Button>}
        {money && (
          <Button variant="outline" className="h-12 flex-1 rounded-2xl lg:h-11 lg:flex-none lg:rounded-xl" onClick={openNew}>
            <Plus /> Tambah Item
          </Button>
        )}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:gap-1.5 lg:px-0" role="group" aria-label="Kategori merek HP">
        {[{ value: "semua", label: "Semua Merek", count: parts?.length ?? 0 }, ...quickBrands.map((brand) => ({ value: brand, label: brand, count: brandCounts.get(brand) ?? 0 }))].map((brand) => (
          <button key={brand.value} type="button" aria-pressed={brandFilter === brand.value} onClick={() => setBrandFilter(brand.value)} className={cn("min-h-11 shrink-0 rounded-2xl border px-3 py-2 text-xs font-medium lg:min-h-0 lg:rounded-full", brandFilter === brand.value ? "border-brand-950 bg-brand-950 text-white" : "border-slate-200 bg-white text-slate-600")}>
            {brand.label} <span className="ml-1 opacity-60">{brand.count}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            aria-label="Cari sparepart atau aksesoris"
            className="h-12 rounded-2xl border-transparent bg-white pl-9 pr-10 shadow-sm lg:h-11 lg:rounded-xl lg:border-slate-300 lg:shadow-none [&::-webkit-search-cancel-button]:appearance-none"
            placeholder="Cari nama atau tipe barang…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <button type="button" aria-label="Hapus pencarian" onClick={() => setQ("")} className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-slate-700"><X className="size-4" /></button>}
        </div>
        <Button variant={filterCount ? "default" : "outline"} className="h-12 shrink-0 rounded-2xl px-3 lg:h-11 lg:rounded-xl lg:px-4" aria-label={filterCount ? `Filter stok, ${filterCount} aktif` : "Filter stok"} aria-haspopup="dialog" aria-expanded={filterOpen} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal /><span className="hidden min-[380px]:inline">Filter</span>{filterCount > 0 && ` (${filterCount})`}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500" aria-live="polite">
        <span>{parts === undefined ? "Memuat stok…" : `${filtered?.length ?? 0} dari ${parts.length} item`}</span>
        {(searching || filterCount > 0) && <button type="button" className="font-medium text-brand-600 underline" onClick={() => { setQ(""); resetFilters(); }}>Reset pencarian & filter</button>}
      </div>
      {filterCount > 0 && (
        <p className="text-xs text-slate-500">
          Filter: {[brandFilter !== "semua" ? brandFilter : "", category !== "semua" ? (category === "sparepart" ? "Sparepart" : "Aksesoris") : "", stock !== "semua" ? ({ tersedia: "Stok tersedia", menipis: "Stok menipis", habis: "Stok habis", "perlu-restok": "Perlu restok" } as const)[stock] : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      </section>
      {parts?.length === 0 && (
        <EmptyState
          icon={<Package />}
          title="Belum ada sparepart/aksesoris"
          hint="Contoh: LCD, baterai, charger, softcase, anti gores."
        />
      )}
      {!!parts?.length && filtered?.length === 0 && (
        <EmptyState icon={<Search />} title="Tidak ada barang yang cocok" hint="Coba nama lain atau reset pencarian dan filter." />
      )}
      <div className={cn("space-y-4 lg:space-y-0 lg:overflow-x-auto lg:rounded-[22px] lg:border lg:border-slate-200/80 lg:bg-white", !filtered?.length && "hidden")}>
      {!!filtered?.length && <div className={cn("hidden items-center gap-4 border-b border-slate-200/70 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid", tableColumns)}><span>Barang / kategori</span><span>Merek</span><span>Stok</span>{money && <span className="text-right" title="Modal rata-rata per pcs">Harga beli</span>}<span className="text-right">Harga jual</span><span /></div>}
      {filtered?.map((p) => (
        <PartRow
          key={p.id}
          onClick={money ? () => openEdit(p) : undefined}
          className={cn(
            "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-4 rounded-3xl border border-white bg-white p-4 text-left shadow-sm lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:border-slate-100 lg:px-5 lg:py-4 lg:shadow-none lg:last:border-b-0",
            tableColumns,
            money && "hover:border-brand-300 lg:hover:bg-brand-50/50",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-semibold leading-snug lg:truncate lg:text-sm lg:text-brand-950">{p.nama}</p>
            <p className="mt-2 text-xs text-slate-400 lg:mt-1.5"><span className="mr-1 inline-flex rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-600 lg:hidden">{getPartBrand(p)}</span> <span className="capitalize">{p.kategori}</span></p>
            {money && <p className="mt-2 text-xs tabular-nums text-slate-500 lg:hidden">Harga beli {rp(p.hargaModal)} / pcs</p>}
          </div>
          <span className="hidden text-xs font-medium text-slate-600 lg:block">{getPartBrand(p)}</span>
          <Tag
            className={cn(
              "min-w-12 flex-col rounded-2xl px-3 py-2 text-lg font-bold lg:min-w-0 lg:w-fit lg:flex-row lg:rounded-lg lg:px-3 lg:py-1.5 lg:text-xs lg:font-semibold",
              p.stok <= p.minStok && "bg-red-100 text-red-700",
            )}
          >
            {p.stok}<span className="hidden pl-1 font-normal opacity-70 lg:inline">pcs</span><span className="text-[9px] font-medium uppercase tracking-wide lg:hidden">{p.stok === 0 ? "habis" : p.stok <= p.minStok ? "menipis" : "stok"}</span>
          </Tag>
          {money && <p className="hidden whitespace-nowrap text-right text-sm tabular-nums text-slate-600 lg:block">{rp(p.hargaModal)}</p>}
          <div className="col-span-2 flex items-center justify-between border-t border-slate-100 pt-3 lg:contents"><p className="font-bold tabular-nums lg:text-right lg:text-sm lg:text-brand-950">{rp(p.hargaJual)}<span className="ml-1 text-xs font-normal text-slate-400 lg:hidden">/ pcs</span></p>{money && <span className="flex items-center gap-1 text-xs text-slate-400 lg:hidden">Kelola <ChevronRight className="size-4" /></span>}</div>
          {money ? <ChevronRight className="hidden size-4 text-slate-300 group-hover:text-brand-700 lg:block" /> : <span className="hidden lg:block" />}
        </PartRow>
      ))}
      </div>

      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter Stok">
        <div className="space-y-4">
          <Field label="Merek HP">
            <Select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
              <option value="semua">Semua merek</option>
              {PART_BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </Select>
          </Field>
          <Field label="Kategori">
            <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              <option value="semua">Semua kategori</option>
              <option value="sparepart">Sparepart</option>
              <option value="aksesoris">Aksesoris</option>
            </Select>
          </Field>
          <Field label="Kondisi stok" hint="Stok menipis berarti masih tersedia, tetapi sudah mencapai batas minimum.">
            <Select value={stock} onChange={(e) => setStock(e.target.value as typeof stock)}>
              <option value="semua">Semua stok</option>
              <option value="tersedia">Tersedia (stok lebih dari 0)</option>
              <option value="menipis">Menipis (stok ≤ minimum)</option>
              <option value="habis">Habis (stok 0)</option>
              <option value="perlu-restok">Perlu restok (termasuk habis)</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={resetFilters}>Reset Filter</Button>
            <Button className="flex-1" onClick={() => setFilterOpen(false)}>Lihat Hasil ({filtered?.length ?? 0})</Button>
          </div>
        </div>
      </Modal>

      {/* Form part */}
      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Ubah Item" : "Tambah Item"}
      >
        <div className="space-y-4">
          <Field label="Nama item" required>
            <Input
              value={f.nama}
              onChange={(e) => setF({ ...f, nama: e.target.value })}
              placeholder="LCD Redmi Note 12 / Softcase bening…"
            />
          </Field>
          <Field label="Kategori">
            <Select
              value={f.kategori}
              onChange={(e) =>
                setF({ ...f, kategori: e.target.value as Part["kategori"] })
              }
            >
              <option value="sparepart">Sparepart</option>
              <option value="aksesoris">Aksesoris</option>
            </Select>
          </Field>
          <Field label="Merek HP" required hint="Pilih Universal untuk barang yang tidak khusus satu merek.">
            <Select value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })}>
              <option value="">— pilih merek —</option>
              {PART_BRANDS.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={editing ? "Stok (terkunci)" : "Stok awal"}
              hint={editing ? "Ubah lewat Restok / Penyesuaian di bawah." : undefined}
            >
              <RpInput
                value={f.stok}
                onChange={(n) => setF({ ...f, stok: n })}
                disabled={!!editing}
              />
            </Field>
            <Field label="Stok minimum" hint="Peringatan saat menipis">
              <RpInput value={f.minStok} onChange={(n) => setF({ ...f, minStok: n })} />
            </Field>
            <Field label="Harga modal /pcs">
              <RpInput value={f.hargaModal} onChange={(n) => setF({ ...f, hargaModal: n })} />
            </Field>
            <Field label="Harga jual /pcs">
              <RpInput value={f.hargaJual} onChange={(n) => setF({ ...f, hargaJual: n })} />
            </Field>
          </div>
          {editing && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setFormOpen(false);
                  setRestokPart(editing);
                }}
              >
                <PackagePlus /> Restok
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setFormOpen(false);
                  setAdjustPart(editing);
                }}
              >
                <SlidersHorizontal /> Penyesuaian
              </Button>
            </div>
          )}
          <Button size="lg" className="w-full" disabled={!f.nama.trim() || !f.brand || busy} onClick={save}>
            Simpan
          </Button>
        </div>
      </Sheet>

      {/* Jual cepat */}
      <Sheet open={sellOpen} onClose={() => setSellOpen(false)} title="Jual Aksesoris / Part">
        <div className="space-y-4">
          <Field label="Item" required>
            <Select
              value={sale.partId}
              onChange={(e) => {
                const p = parts?.find((x) => x.id === e.target.value);
                setSale({
                  ...sale,
                  partId: e.target.value,
                  qty: 1,
                  harga: p?.hargaJual ?? 0,
                });
              }}
            >
              <option value="">— pilih —</option>
              {parts?.map((p) => (
                <option key={p.id} value={p.id} disabled={p.stok <= 0}>
                  {p.nama} (stok {p.stok})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Jumlah">
              <Input
                inputMode="numeric"
                value={sale.qty}
                onChange={(e) =>
                  setSale({
                    ...sale,
                    qty: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1),
                  })
                }
              />
            </Field>
            <Field label="Harga /pcs">
              <RpInput value={sale.harga} onChange={(n) => setSale({ ...sale, harga: n })} />
            </Field>
          </div>
          <Field label="Metode pembayaran">
            <MethodPicker
              value={sale.method}
              onChange={(m) => setSale({ ...sale, method: m })}
            />
          </Field>
          {selPart && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm">
              Total: <b>{rp(sale.harga * sale.qty)}</b> — masuk Kas otomatis.
            </p>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={!sale.partId || sale.harga <= 0 || busy}
            onClick={doSell}
          >
            Catat Penjualan
          </Button>
        </div>
      </Sheet>

      <RestokSheet part={restokPart} onClose={() => setRestokPart(null)} />
      <AdjustSheet part={adjustPart} onClose={() => setAdjustPart(null)} />
    </div>
  );
}

/** Restok: stok bertambah + kas keluar tertaut — jejak lengkap. */
function RestokSheet({ part, onClose }: { part: Part | null; onClose: () => void; }) {
  const user = useUser();
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [biaya, setBiaya] = useState(0);
  const [method, setMethod] = useState<CashMethod>("tunai");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (part && part.id !== lastId) {
    setLastId(part.id);
    setQty(1);
    setBiaya(0);
    setMethod("tunai");
  }
  if (!part) return null;

  return (
    <Sheet open onClose={onClose} title={`Restok — ${part.nama}`}>
      <div className="space-y-4">
        <Field label="Jumlah masuk" required>
          <Input
            inputMode="numeric"
            value={qty}
            onChange={(e) =>
              setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))
            }
          />
        </Field>
        <Field label="Total biaya pembelian" hint="0 bila tidak lewat kas (mis. sudah dibayar terpisah).">
          <RpInput value={biaya} onChange={setBiaya} />
        </Field>
        {biaya > 0 && (
          <Field label="Metode pembayaran">
            <MethodPicker value={method} onChange={setMethod} />
          </Field>
        )}
        <p className="rounded-xl bg-slate-50 p-3 text-sm">
          Stok: {part.stok} → <b>{part.stok + qty}</b>
        </p>
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await restockPart(user, part.id, qty, biaya, method);
              toast("Restok tercatat");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Catat Restok
        </Button>
      </div>
    </Sheet>
  );
}

/** Penyesuaian/opname: wajib alasan, audit mencatat nilai sebelum → sesudah. */
function AdjustSheet({ part, onClose }: { part: Part | null; onClose: () => void; }) {
  const user = useUser();
  const toast = useToast();
  const [stok, setStok] = useState(0);
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  if (!part && lastId !== null) setLastId(null);
  if (part && part.id !== lastId) {
    setLastId(part.id);
    setStok(part.stok);
    setAlasan("");
  }
  if (!part) return null;

  return (
    <Sheet open onClose={onClose} title={`Penyesuaian Stok — ${part.nama}`}>
      <div className="space-y-4">
        <Field label="Stok hasil hitung fisik" required>
          <RpInput value={stok} onChange={setStok} />
        </Field>
        <Field label="Alasan" required hint="Contoh: opname bulanan, 1 pcs rusak/pecah, selisih hitung.">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} />
        </Field>
        <p
          className={cn(
            "rounded-xl p-3 text-sm",
            stok === part.stok ? "bg-slate-50" : "bg-accent-50 text-accent-800",
          )}
        >
          {part.stok} → <b>{stok}</b>{" "}
          {stok !== part.stok && `(selisih ${stok - part.stok})`}
        </p>
        <Button
          size="lg"
          className="w-full"
          disabled={!alasan.trim() || stok === part.stok || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await adjustPartStock(user, part.id, stok, alasan.trim(), part.stok);
              toast("Penyesuaian tercatat di audit");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Simpan Penyesuaian
        </Button>
      </div>
    </Sheet>
  );
}
