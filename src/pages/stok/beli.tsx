import { canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { MethodPicker } from "@/components/method-picker";
import { PendingPhotos } from "@/components/photos";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, RpInput, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { db, uid } from "@/db/db";
import type { CashMethod, Unit } from "@/db/types";
import { buyUnit } from "@/db/units";
import { rp } from "@/lib/format";
import { luhnValidImei } from "@/lib/imei";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function BeliUnitPage() {
  const user = useUser();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    brand: "",
    model: "",
    varian: "",
    imei: "",
    kondisi: "",
    hargaBeli: 0,
    hargaJual: 0,
    sellerName: "",
    sellerPhone: "",
    garansiHari: 7,
  });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [ktp, setKtp] = useState<Blob[]>([]);
  const [method, setMethod] = useState<CashMethod>("tunai");
  const [dupe, setDupe] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(uid());
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!canSeeMoney(user.role)) return;
    let cancelled = false;
    void (async () => {
      const raw = await db.settings.get("draftBeliBaru");
      const images = await db.photos.where("refId").anyOf(["beli-baru", "beli-baru-ktp"]).and((p) => p.refType === "draft").toArray();
      if (cancelled) return;
      if (raw?.value) {
        const draft = JSON.parse(raw.value);
        const valid = Object.entries(f).every(([key, value]) => typeof draft.f?.[key] === typeof value);
        if (valid) { setF(draft.f); setMethod(["tunai", "qris", "transfer"].includes(draft.method) ? draft.method : "tunai"); setRestored(true); }
      }
      setPhotos(images.filter((p) => p.refId === "beli-baru").map((p) => p.blob));
      setKtp(images.filter((p) => p.refId === "beli-baru-ktp").map((p) => p.blob));
      setLoaded(true);
    })().catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!loaded || busy || !canSeeMoney(user.role)) return;
    const timer = setTimeout(() => {
      if (saving.current) return;
      void db.transaction("rw", [db.settings, db.photos], async () => {
        await db.settings.put({ key: "draftBeliBaru", value: f.brand || f.model || f.varian || f.imei || f.kondisi || f.sellerName || f.sellerPhone || f.hargaBeli || f.hargaJual || photos.length || ktp.length ? JSON.stringify({ f, method }) : "" });
        const keys = await db.photos.where("refId").anyOf(["beli-baru", "beli-baru-ktp"]).and((p) => p.refType === "draft").primaryKeys();
        await db.photos.bulkDelete(keys);
        for (const [refId, blobs] of [["beli-baru", photos], ["beli-baru-ktp", ktp]] as const) {
          for (const blob of blobs) await db.photos.add({ id: uid(), refType: "draft", refId, blob, createdAt: Date.now() });
        }
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [f, method, photos, ktp, loaded, busy]);

  if (!canSeeMoney(user.role)) {
    return (
      <>
        <PageHeader title="Beli Unit HP" />
        <PageBody>
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Pembelian unit hanya bisa dilakukan Owner / Head Operasional.
          </p>
        </PageBody>
      </>
    );
  }

  if (!loaded) return <PageBody>Memuat draft…</PageBody>;

  const imeiOk = luhnValidImei(f.imei);
  const imeiSuspect = f.imei.length === 15 && !luhnValidImei(f.imei);
  const valid =
    f.brand.trim() && imeiOk && f.hargaBeli > 0 && f.sellerName.trim() && photos.length > 0 && ktp.length > 0;

  async function doSave() {
    saving.current = true;
    setBusy(true);
    try {
      const u = await buyUnit(user, f, photos, ktp[0] ?? null, method, requestId.current);
      toast(`Unit ${u.kode} masuk stok — kas keluar ${rp(f.hargaBeli)}`);
      nav(`/app/stok/unit/${u.id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan", "error");
      saving.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (!valid || busy) return;
    // IMEI sama = kemungkinan unit balik/retur atau salah input — wajib sadar.
    const existing = await db.units.where("imei").equals(f.imei).first();
    if (existing) {
      setDupe(existing);
      return;
    }
    await doSave();
  }

  return (
    <>
      <PageHeader
        title="Beli Unit HP"
        back={
          <Link to="/app/stok" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="size-5" />
          </Link>
        }
      />
      <PageBody>
        {restored && <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">Draft pembelian terakhir dipulihkan, termasuk foto yang sudah tersimpan.</p>}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold">Data unit</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Merk" required>
              <Input autoFocus value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
            </Field>
            <Field label="Tipe">
              <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
            </Field>
            <Field label="Varian (RAM/ROM/warna)">
              <Input placeholder="8/256 Hitam" value={f.varian} onChange={(e) => setF({ ...f, varian: e.target.value })} />
            </Field>
            <Field label="IMEI" required hint="Dial *#06# untuk melihat IMEI">
              <Input
                inputMode="numeric"
                value={f.imei}
                onChange={(e) => setF({ ...f, imei: e.target.value.replace(/\D/g, "") })}
              />
              {imeiSuspect && (
                <span className="mt-1 block text-xs font-medium text-accent-600">
                  ⚠ Digit cek IMEI tidak cocok — kemungkinan salah ketik, periksa lagi.
                </span>
              )}
            </Field>
          </div>
          <Field label="Catatan kondisi">
            <Textarea
              placeholder="Lecet ringan di sudut, baterai sehat 89%…"
              value={f.kondisi}
              onChange={(e) => setF({ ...f, kondisi: e.target.value })}
            />
          </Field>
          <Field label="Foto unit" required>
            <PendingPhotos blobs={photos} onChange={setPhotos} />
          </Field>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold">Penjual</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama penjual" required>
              <Input value={f.sellerName} onChange={(e) => setF({ ...f, sellerName: e.target.value })} />
            </Field>
            <Field label="No. HP penjual">
              <Input inputMode="tel" value={f.sellerPhone} onChange={(e) => setF({ ...f, sellerPhone: e.target.value })} />
            </Field>
          </div>
          <Field label="Foto KTP penjual" required hint="Wajib untuk keamanan legalitas unit bekas.">
            <PendingPhotos blobs={ktp} onChange={(b) => setKtp(b.slice(-1))} label="Foto KTP" />
          </Field>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold">Harga & pembayaran</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Harga beli" required hint="Otomatis tercatat sebagai kas keluar.">
              <RpInput value={f.hargaBeli} onChange={(n) => setF({ ...f, hargaBeli: n })} />
            </Field>
            <Field label="Rencana harga jual" hint="Bisa diubah nanti; tampil di katalog bila diisi.">
              <RpInput value={f.hargaJual} onChange={(n) => setF({ ...f, hargaJual: n })} />
            </Field>
          </div>
          <Field label="Dibayar via">
            <MethodPicker value={method} onChange={setMethod} />
          </Field>
        </div>

        <Button size="lg" className="w-full" disabled={!valid || busy} onClick={submit}>
          Simpan — Kas Keluar {rp(f.hargaBeli)}
        </Button>
      </PageBody>

      <ConfirmDialog
        open={!!dupe}
        title="IMEI sudah terdaftar"
        confirmLabel="Tetap simpan"
        busy={busy}
        onCancel={() => setDupe(null)}
        onConfirm={async () => {
          setDupe(null);
          await doSave();
        }}
      >
        IMEI ini sudah ada di sistem sebagai <b>{dupe?.kode}</b> ({dupe?.brand}{" "}
        {dupe?.model}, status {dupe?.status}). Bisa jadi unit balik dari pembeli
        atau salah ketik. Yakin tetap mencatat sebagai unit baru?
      </ConfirmDialog>
    </>
  );
}
