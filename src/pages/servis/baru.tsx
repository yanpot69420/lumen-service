import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useUser } from "@/auth/session";
import { createTicket } from "@/db/tickets";
import type { CashMethod } from "@/db/types";
import { MethodPicker } from "@/components/method-picker";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Textarea } from "@/components/ui/field";
import { PendingPhotos } from "@/components/photos";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const KELENGKAPAN = ["Charger", "Kartu SIM", "Memory Card", "Casing", "SIM Tray"];

export function ServisBaruPage() {
  const user = useUser();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({
    customerName: "",
    phone: "",
    brand: "",
    model: "",
    keluhan: "",
    estimasi: 0,
    dp: 0,
  });
  const [kelengkapan, setKelengkapan] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [dpMethod, setDpMethod] = useState<CashMethod>("tunai");
  const [busy, setBusy] = useState(false);

  const valid = f.customerName.trim() && f.brand.trim() && f.keluhan.trim();

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const t = await createTicket(user, { ...f, kelengkapan }, photos, dpMethod);
      toast(`Nota ${t.noNota} dibuat`);
      nav(`/app/servis/${t.id}`, { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal menyimpan", "error");
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (v: string | number) =>
    setF((s) => ({ ...s, [k]: v }));

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
            hint="Bukti kondisi awal — melindungi dari sengketa."
          >
            <PendingPhotos blobs={photos} onChange={setPhotos} />
          </Field>
        </div>
        <Button size="lg" className="w-full" disabled={!valid || busy} onClick={submit}>
          Simpan Nota
        </Button>
      </PageBody>
    </>
  );
}
