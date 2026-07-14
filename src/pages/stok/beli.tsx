import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db/db";
import { useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { buyUnit } from "@/db/units";
import type { CashMethod, Unit } from "@/db/types";
import { luhnValidImei } from "@/lib/imei";
import { rp } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Textarea } from "@/components/ui/field";
import { MethodPicker } from "@/components/method-picker";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PendingPhotos } from "@/components/photos";
import { useToast } from "@/components/ui/toast";

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

  const imeiOk = f.imei.length >= 14;
  const imeiSuspect = f.imei.length === 15 && !luhnValidImei(f.imei);
  const valid =
    f.brand.trim() && imeiOk && f.hargaBeli > 0 && f.sellerName.trim();

  async function doSave() {
    setBusy(true);
    try {
      const u = await buyUnit(user, f, photos, ktp[0] ?? null, method);
      toast(`Unit ${u.kode} masuk stok — kas keluar ${rp(f.hargaBeli)}`);
      nav(`/app/stok/unit/${u.id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan", "error");
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
                <span className="mt-1 block text-xs font-medium text-amber-600">
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
          <Field label="Foto unit">
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
          <Field label="Foto KTP penjual" hint="Wajib untuk keamanan legalitas unit bekas.">
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
