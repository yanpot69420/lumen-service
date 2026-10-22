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
import { createBufferedDraft } from "@/lib/buffered-draft";
import { readUnitPurchaseDraft, writeUnitPurchaseDraft, type UnitPurchaseDraft } from "@/lib/unit-purchase-draft";
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
  const [photoBusy, setPhotoBusy] = useState({ unit: false, ktp: false });
  const photoBusyRef = useRef({ unit: false, ktp: false });
  const requestId = useRef(uid());
  const saving = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [restored, setRestored] = useState(false);
  const draftError = useRef(false);
  const draftWriter = useRef<ReturnType<typeof createBufferedDraft<UnitPurchaseDraft>> | null>(null);
  if (!draftWriter.current) draftWriter.current = createBufferedDraft(writeUnitPurchaseDraft, 400, () => { draftError.current = false; });
  const latestDraft = useRef<UnitPurchaseDraft>({ f, method, photos, ktp });
  latestDraft.current = { f, method, photos, ktp };
  const draftLoaded = useRef(false);
  const reportDraftError = useRef((error: unknown) => {
    if (!draftError.current) toast(error instanceof Error ? error.message : "Draft belum tersimpan. Coba lagi sebelum menutup halaman.", "error");
    draftError.current = true;
  });
  useEffect(() => {
    if (!canSeeMoney(user.role)) return;
    let cancelled = false;
    setLoadError(false);
    void (async () => {
      const { raw, images } = await readUnitPurchaseDraft();
      if (cancelled) return;
      if (raw?.value) {
        const draft = JSON.parse(raw.value);
        const valid = Object.entries(f).every(([key, value]) => typeof draft.f?.[key] === typeof value);
        if (valid) { setF(draft.f); setMethod(["tunai", "qris", "transfer"].includes(draft.method) ? draft.method : "tunai"); setRestored(true); }
      }
      setPhotos(images.filter((p) => p.refId === "beli-baru").map((p) => p.blob));
      setKtp(images.filter((p) => p.refId === "beli-baru-ktp").map((p) => p.blob));
      draftLoaded.current = true;
      setLoaded(true);
    })().catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [loadAttempt]);
  useEffect(() => {
    if (!loaded || busy || !canSeeMoney(user.role)) return;
    draftWriter.current!.schedule(latestDraft.current, reportDraftError.current);
    return () => draftWriter.current!.cancelTimer();
  }, [f, method, photos, ktp, loaded, busy]);
  useEffect(() => {
    const flush = () => {
      if (!draftLoaded.current || saving.current) return;
      draftWriter.current!.set(latestDraft.current);
      void draftWriter.current!.flush().catch(reportDraftError.current);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  function updatePhotoBusy(kind: "unit" | "ktp", value: boolean) {
    photoBusyRef.current = { ...photoBusyRef.current, [kind]: value };
    setPhotoBusy(photoBusyRef.current);
  }

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

  if (!loaded) return <PageBody>{loadError ? <div className="space-y-3"><p role="alert" className="text-sm text-red-600">Draft pembelian belum dapat dimuat. Coba lagi agar data yang tersimpan tetap aman.</p><Button variant="outline" onClick={() => setLoadAttempt((value) => value + 1)}>Coba lagi</Button></div> : "Memuat draft…"}</PageBody>;

  const imeiOk = luhnValidImei(f.imei);
  const imeiSuspect = f.imei.length === 15 && !luhnValidImei(f.imei);
  const valid =
    f.brand.trim() && imeiOk && f.hargaBeli > 0 && f.sellerName.trim() && photos.length > 0 && ktp.length > 0;

  async function doSave() {
    if (saving.current || photoBusyRef.current.unit || photoBusyRef.current.ktp) return;
    saving.current = true;
    setBusy(true);
    try {
      // Finish every queued autosave before buyUnit atomically clears the draft.
      draftWriter.current!.set(latestDraft.current);
      await draftWriter.current!.flush();
      draftWriter.current!.pause();
      const snapshot = latestDraft.current;
      const u = await buyUnit(user, snapshot.f, snapshot.photos, snapshot.ktp[0] ?? null, snapshot.method, requestId.current);
      toast(`Unit ${u.kode} masuk stok — kas keluar ${rp(f.hargaBeli)}`);
      nav(`/app/stok/unit/${u.id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan", "error");
      saving.current = false;
      draftWriter.current!.resume();
      setBusy(false);
    }
  }

  async function submit() {
    if (!valid || busy || saving.current || photoBusyRef.current.unit || photoBusyRef.current.ktp) return;
    // IMEI sama = kemungkinan unit balik/retur atau salah input — wajib sadar.
    try {
      const existing = await db.units.where("imei").equals(f.imei).first();
      if (existing) { setDupe(existing); return; }
      await doSave();
    } catch (error) { toast(error instanceof Error ? error.message : "Gagal memeriksa IMEI", "error"); }
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
        <fieldset disabled={busy || !!dupe} className="min-w-0 space-y-4">
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
            <PendingPhotos blobs={photos} onChange={setPhotos} disabled={busy || !!dupe} onBusyChange={(value) => updatePhotoBusy("unit", value)} />
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
            <PendingPhotos blobs={ktp} onChange={(b) => setKtp(b.slice(-1))} label="Foto KTP" disabled={busy || !!dupe} onBusyChange={(value) => updatePhotoBusy("ktp", value)} />
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

        <Button size="lg" className="w-full" disabled={!valid || busy || photoBusy.unit || photoBusy.ktp} onClick={submit}>
          {photoBusy.unit || photoBusy.ktp ? "Menyiapkan foto…" : busy ? "Menyimpan…" : `Simpan — Kas Keluar ${rp(f.hargaBeli)}`}
        </Button>
        </fieldset>
      </PageBody>

      <ConfirmDialog
        open={!!dupe}
        title="IMEI sudah terdaftar"
        confirmLabel="Tetap simpan"
        busy={busy || photoBusy.unit || photoBusy.ktp}
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
