import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { db } from "@/db/db";
import { useUser } from "@/auth/session";
import { createTicket } from "@/db/tickets";
import { getSetting, setSetting } from "@/db/settings";
import type { CashMethod } from "@/db/types";
import { MethodPicker } from "@/components/method-picker";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Textarea } from "@/components/ui/field";
import { PhotoManager } from "@/components/photos";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const KELENGKAPAN = ["Charger", "Kartu SIM", "Memory Card", "Casing", "SIM Tray"];
const DRAFT_KEY = "draftServisBaru";
const DRAFT_PHOTO_REF = { refType: "draft" as const, refId: "servis-baru" };

const EMPTY = {
  customerName: "",
  phone: "",
  brand: "",
  model: "",
  keluhan: "",
  estimasi: 0,
  dp: 0,
};

export function ServisBaruPage() {
  const user = useUser();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [kelengkapan, setKelengkapan] = useState<string[]>([]);
  const [dpMethod, setDpMethod] = useState<CashMethod>("tunai");
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pulihkan draft — kasir sering terpotong pelanggan lain / refresh tak sengaja.
  useEffect(() => {
    (async () => {
      try {
        const raw = await getSetting(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          setF({ ...EMPTY, ...d.f });
          setKelengkapan(d.kelengkapan ?? []);
          setDpMethod(d.dpMethod ?? "tunai");
          setRestored(true);
        }
      } catch {
        /* draft korup — abaikan */
      }
      setLoaded(true);
    })();
  }, []);

  // Simpan draft otomatis (debounce 400ms).
  useEffect(() => {
    if (!loaded || busy) return;
    const t = setTimeout(() => {
      const kosong =
        !f.customerName && !f.phone && !f.brand && !f.model && !f.keluhan &&
        !f.estimasi && !f.dp && kelengkapan.length === 0;
      setSetting(DRAFT_KEY, kosong ? "" : JSON.stringify({ f, kelengkapan, dpMethod }));
    }, 400);
    return () => clearTimeout(t);
  }, [f, kelengkapan, dpMethod, loaded, busy]);

  const valid = f.customerName.trim() && f.brand.trim() && f.keluhan.trim();

  async function clearDraft() {
    setF(EMPTY);
    setKelengkapan([]);
    setDpMethod("tunai");
    setRestored(false);
    await setSetting(DRAFT_KEY, "");
    await db.photos.where(DRAFT_PHOTO_REF).delete();
  }

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const t = await createTicket(user, { ...f, kelengkapan }, [], dpMethod);
      // Foto draft resmi jadi milik nota ini.
      await db.photos
        .where(DRAFT_PHOTO_REF)
        .modify({ refType: "ticket", refId: t.id });
      await setSetting(DRAFT_KEY, "");
      toast(`Nota ${t.noNota} dibuat`);
      nav(`/app/servis/${t.id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan", "error");
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (v: string | number) =>
    setF((s) => ({ ...s, [k]: v }));

  if (!loaded) return null;

  return (
    <>
      <PageHeader
        title="Nota Servis Baru"
        back={
          <Link to="/app/servis" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="size-5" />
          </Link>
        }
      />
      <PageBody>
        {restored && (
          <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            Draft terakhir dipulihkan — lanjutkan atau
            <button
              onClick={clearDraft}
              className="inline-flex items-center gap-1 font-semibold underline"
            >
              <Trash2 className="size-3.5" /> buang draft
            </button>
          </div>
        )}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama pelanggan" required>
              <Input
                autoFocus
                value={f.customerName}
                onChange={(e) => set("customerName")(e.target.value)}
              />
            </Field>
            <Field label="No. WA pelanggan">
              <Input
                inputMode="tel"
                placeholder="08xxxxxxxxxx"
                value={f.phone}
                onChange={(e) => set("phone")(e.target.value)}
              />
            </Field>
            <Field label="Merk HP" required>
              <Input
                placeholder="Samsung / Xiaomi / iPhone…"
                value={f.brand}
                onChange={(e) => set("brand")(e.target.value)}
              />
            </Field>
            <Field label="Tipe">
              <Input
                placeholder="A54 / Redmi Note 12…"
                value={f.model}
                onChange={(e) => set("model")(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Keluhan" required>
            <Textarea
              placeholder="LCD pecah, mati total, baterai boros…"
              value={f.keluhan}
              onChange={(e) => set("keluhan")(e.target.value)}
            />
          </Field>
          <Field label="Kelengkapan yang dititipkan">
            <div className="flex flex-wrap gap-1.5">
              {KELENGKAPAN.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setKelengkapan((xs) =>
                      xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k],
                    )
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                    kelengkapan.includes(k)
                      ? "bg-brand-950 text-white"
                      : "border border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimasi biaya">
              <RpInput value={f.estimasi} onChange={set("estimasi")} />
            </Field>
            <Field label="DP (uang muka)">
              <RpInput value={f.dp} onChange={set("dp")} />
            </Field>
          </div>
          {f.dp > 0 && (
            <Field label="Metode pembayaran DP">
              <MethodPicker value={dpMethod} onChange={setDpMethod} />
            </Field>
          )}
          <Field
            label="Foto kondisi HP saat diterima"
            hint="Bukti kondisi awal — melindungi dari sengketa. Foto ikut tersimpan di draft."
          >
            <PhotoManager
              refType={DRAFT_PHOTO_REF.refType}
              refId={DRAFT_PHOTO_REF.refId}
              canDelete
            />
          </Field>
        </div>
        <Button size="lg" className="w-full" disabled={!valid || busy} onClick={submit}>
          Simpan Nota
        </Button>
      </PageBody>
    </>
  );
}
