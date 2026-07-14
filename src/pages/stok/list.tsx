import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Plus,
  Search,
  Smartphone,
  Package,
  ShoppingCart,
  PackagePlus,
  SlidersHorizontal,
} from "lucide-react";
import { db, uid } from "@/db/db";
import type { CashMethod, Part } from "@/db/types";
import { addCash } from "@/db/cash";
import { logAudit } from "@/db/audit";
import { useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { rp, daysSince } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { MethodPicker } from "@/components/method-picker";
import { UnitStatusTag, Tag } from "@/components/ui/status-tag";
import { EmptyState } from "@/components/ui/misc";
import { FirstPhoto } from "@/components/photos";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

export function StokPage() {
  const user = useUser();
  const [tab, setTab] = useState<"unit" | "part">("unit");
  return (
    <>
      <PageHeader
        title="Stok"
        action={
          tab === "unit" && canSeeMoney(user.role) ? (
            <Link
              to="/app/stok/beli"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-accent-500 px-3 text-xs font-semibold text-brand-950 hover:bg-accent-400"
            >
              <Plus className="size-4" /> Beli Unit
            </Link>
          ) : undefined
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 text-sm font-medium">
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
                "rounded-lg py-2 transition-colors",
                tab === k ? "bg-white shadow-sm" : "text-slate-500",
              )}
            >
              {label}
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

  return (
    <div className="space-y-3">
      {money && (
        <div className="flex items-center justify-between rounded-2xl bg-brand-950 p-4 text-white">
          <div>
            <p className="text-xs text-slate-300">Nilai stok (modal parkir)</p>
            <p className="text-lg font-bold tabular-nums">{rp(nilaiStok)}</p>
          </div>
          <button
            onClick={() => setShowSold((v) => !v)}
            className="rounded-full border border-white/20 px-3 py-1.5 text-xs"
          >
            {showSold ? "Sembunyikan terjual" : "Tampilkan terjual"}
          </button>
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Cari kode / tipe / IMEI…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {filtered?.length === 0 && (
        <EmptyState
          icon={<Smartphone />}
          title="Belum ada unit di stok"
          hint="Tekan “Beli Unit” saat menerima HP dari penjual."
        />
      )}
      {filtered?.map((u) => {
        const umur = daysSince(u.boughtAt);
        return (
          <Link
            key={u.id}
            to={`/app/stok/unit/${u.id}`}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:border-brand-300"
          >
            <FirstPhoto refType="unit" refId={u.id} className="size-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-brand-600">
                  {u.kode}
                </span>
                <UnitStatusTag status={u.status} />
                {u.status === "stok" && umur > 60 && (
                  <Tag className="bg-red-100 text-red-700">{umur} hari</Tag>
                )}
              </div>
              <p className="truncate text-sm font-semibold">
                {u.brand} {u.model} {u.varian}
              </p>
              <p className="truncate text-xs text-slate-400">IMEI {u.imei}</p>
            </div>
            <div className="text-right text-sm">
              {u.status === "stok" ? (
                <>
                  <p className="font-bold tabular-nums">
                    {u.hargaJual ? rp(u.hargaJual) : "—"}
                  </p>
                  {money && (
                    <p className="text-xs text-slate-400">modal {rp(u.hargaBeli)}</p>
                  )}
                </>
              ) : money ? (
                <p className="font-bold tabular-nums text-emerald-600">
                  +{rp((u.soldPrice ?? 0) - u.hargaBeli)}
                </p>
              ) : (
                <p className="font-bold tabular-nums">{rp(u.soldPrice ?? 0)}</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function PartTab() {
  const user = useUser();
  const money = canSeeMoney(user.role);
  const toast = useToast();
  const parts = useLiveQuery(() => db.parts.orderBy("nama").toArray(), []);
  const [editing, setEditing] = useState<Part | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [restokPart, setRestokPart] = useState<Part | null>(null);
  const [adjustPart, setAdjustPart] = useState<Part | null>(null);
  const [f, setF] = useState({
    nama: "",
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

  function openNew() {
    setEditing(null);
    setF({ nama: "", kategori: "sparepart", stok: 0, hargaModal: 0, hargaJual: 0, minStok: 1 });
    setFormOpen(true);
  }
  function openEdit(p: Part) {
    if (!money) return;
    setEditing(p);
    setF({ ...p });
    setFormOpen(true);
  }

  async function save() {
    if (!f.nama.trim() || busy) return;
    setBusy(true);
    try {
      if (editing) {
        // Stok TIDAK ikut diubah dari sini — hanya lewat Restok/Penyesuaian.
        await db.parts.update(editing.id, {
          nama: f.nama.trim(),
          kategori: f.kategori,
          hargaModal: f.hargaModal,
          hargaJual: f.hargaJual,
          minStok: f.minStok,
        });
        await logAudit(user, "ubah", "part", editing.id, `Ubah data ${f.nama}`);
      } else {
        const id = uid();
        await db.parts.add({ ...f, id, nama: f.nama.trim() });
        await logAudit(user, "buat", "part", id, `Part baru: ${f.nama} (stok awal ${f.stok})`);
      }
      toast("Tersimpan");
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const selPart = parts?.find((p) => p.id === sale.partId);

  async function doSell() {
    if (!selPart || busy) return;
    if (selPart.stok < sale.qty) {
      toast(`Stok tinggal ${selPart.stok}`, "error");
      return;
    }
    setBusy(true);
    try {
      await db.parts.update(selPart.id, { stok: selPart.stok - sale.qty });
      await addCash(user, {
        type: "in",
        category: "jual_aksesoris",
        amount: sale.harga * sale.qty,
        method: sale.method,
        note: `Jual ${sale.qty}× ${selPart.nama}`,
        refType: "part",
        refId: selPart.id,
        meta: { modal: selPart.hargaModal * sale.qty, qty: sale.qty },
      });
      await logAudit(
        user,
        "jual",
        "part",
        selPart.id,
        `Jual ${sale.qty}× ${selPart.nama} @${rp(sale.harga)}`,
      );
      toast("Penjualan tercatat di Kas");
      setSellOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="accent" className="flex-1" onClick={() => {
          setSale({ partId: "", qty: 1, harga: 0, method: "tunai" });
          setSellOpen(true);
        }}>
          <ShoppingCart /> Jual Cepat
        </Button>
        {money && (
          <Button variant="outline" className="flex-1" onClick={openNew}>
            <Plus /> Tambah Item
          </Button>
        )}
      </div>
      {parts?.length === 0 && (
        <EmptyState
          icon={<Package />}
          title="Belum ada sparepart/aksesoris"
          hint="Contoh: LCD, baterai, charger, softcase, anti gores."
        />
      )}
      {parts?.map((p) => (
        <button
          key={p.id}
          onClick={() => openEdit(p)}
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left",
            money && "hover:border-brand-300",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{p.nama}</p>
            <p className="text-xs text-slate-400 capitalize">{p.kategori}</p>
          </div>
          <Tag
            className={cn(
              p.stok <= p.minStok && "bg-red-100 text-red-700",
            )}
          >
            stok {p.stok}
          </Tag>
          <p className="w-24 text-right text-sm font-bold tabular-nums">
            {rp(p.hargaJual)}
          </p>
        </button>
      ))}

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
          <Button size="lg" className="w-full" disabled={!f.nama.trim() || busy} onClick={save}>
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
function RestokSheet({ part, onClose }: { part: Part | null; onClose: () => void }) {
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
              await db.parts.update(part.id, { stok: part.stok + qty });
              if (biaya > 0) {
                await addCash(user, {
                  type: "out",
                  category: "restok_part",
                  amount: biaya,
                  method,
                  note: `Restok ${qty}× ${part.nama}`,
                  refType: "part",
                  refId: part.id,
                });
              }
              await logAudit(
                user, "restok", "part", part.id,
                `Restok ${part.nama}: ${part.stok} → ${part.stok + qty} (biaya ${rp(biaya)})`,
              );
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
function AdjustSheet({ part, onClose }: { part: Part | null; onClose: () => void }) {
  const user = useUser();
  const toast = useToast();
  const [stok, setStok] = useState(0);
  const [alasan, setAlasan] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
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
            stok === part.stok ? "bg-slate-50" : "bg-amber-50 text-amber-800",
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
              await db.parts.update(part.id, { stok });
              await logAudit(
                user, "opname", "part", part.id,
                `Penyesuaian ${part.nama}: ${part.stok} → ${stok}. Alasan: ${alasan.trim()}`,
              );
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
