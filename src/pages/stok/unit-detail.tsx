import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BadgeCheck, Printer, Undo2 } from "lucide-react";
import { db } from "@/db/db";
import { returUnit, sellUnit } from "@/db/units";
import { logAudit } from "@/db/audit";
import { useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import type { CashMethod } from "@/db/types";
import { rp, fmtDate, daysSince } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { MethodPicker } from "@/components/method-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UnitStatusTag } from "@/components/ui/status-tag";
import { Row } from "@/components/ui/misc";
import { PhotoManager } from "@/components/photos";
import { useToast } from "@/components/ui/toast";

export function UnitDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const money = canSeeMoney(user.role);
  const nav = useNavigate();
  const toast = useToast();
  const unit = useLiveQuery(() => db.units.get(id!), [id]);
  const [sellOpen, setSellOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [returOpen, setReturOpen] = useState(false);
  const [hargaJual, setHargaJual] = useState(0);
  const [sale, setSale] = useState({
    soldPrice: 0,
    buyerName: "",
    buyerPhone: "",
    garansiHari: 7,
    method: "tunai" as CashMethod,
  });
  const [retur, setRetur] = useState({
    refund: 0,
    method: "tunai" as CashMethod,
    alasan: "",
  });
  const [busy, setBusy] = useState(false);

  if (!unit) return null;
  const sold = unit.status === "terjual";

  return (
    <>
      <PageHeader
        title={unit.kode}
        back={
          <Link to="/app/stok" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="size-5" />
          </Link>
        }
        action={
          sold ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => nav(`/app/nota/unit/${unit.id}`)}
            >
              <Printer /> Nota
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold">
                  {unit.brand} {unit.model} {unit.varian}
                </p>
                <p className="font-mono text-xs text-slate-500">IMEI {unit.imei}</p>
              </div>
              <UnitStatusTag status={unit.status} />
            </div>
            {unit.kondisi && (
              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">{unit.kondisi}</p>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2">
              <Row label="Dibeli">{`${fmtDate(unit.boughtAt)} (${daysSince(unit.boughtAt)} hari lalu)`}</Row>
              <Row label="Penjual">{unit.sellerName}{unit.sellerPhone ? ` · ${unit.sellerPhone}` : ""}</Row>
              {money && <Row label="Harga beli (modal)">{rp(unit.hargaBeli)}</Row>}
              {!sold && (
                <Row label="Harga jual" strong>
                  <span className="flex items-center justify-end gap-2">
                    {unit.hargaJual ? rp(unit.hargaJual) : "belum diisi"}
                    {money && (
                      <button
                        onClick={() => {
                          setHargaJual(unit.hargaJual);
                          setPriceOpen(true);
                        }}
                        className="text-xs font-medium text-brand-600 underline"
                      >
                        ubah
                      </button>
                    )}
                  </span>
                </Row>
              )}
              {sold && (
                <>
                  <Row label="Terjual">{fmtDate(unit.soldAt!)}</Row>
                  <Row label="Pembeli">{unit.buyerName || "-"}</Row>
                  <Row label="Harga jual" strong>{rp(unit.soldPrice!)}</Row>
                  {money && (
                    <Row label="Margin" strong>
                      <span className="text-emerald-600">
                        +{rp((unit.soldPrice ?? 0) - unit.hargaBeli)}
                      </span>
                    </Row>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!sold && (
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            onClick={() => {
              setSale({
                soldPrice: unit.hargaJual || 0,
                buyerName: "",
                buyerPhone: "",
                garansiHari: unit.garansiHari || 7,
                method: "tunai",
              });
              setSellOpen(true);
            }}
          >
            <BadgeCheck /> Jual Unit Ini
          </Button>
        )}

        {sold && money && (
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setRetur({ refund: unit.soldPrice ?? 0, method: "tunai", alasan: "" });
              setReturOpen(true);
            }}
          >
            <Undo2 /> Retur Unit (kembali ke stok)
          </Button>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Foto unit</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoManager refType="unit" refId={unit.id} canDelete={!sold} />
          </CardContent>
        </Card>

        {money && (
          <Card>
            <CardHeader>
              <CardTitle>KTP penjual</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoManager refType="unit-ktp" refId={unit.id} label="Foto KTP" />
            </CardContent>
          </Card>
        )}
      </PageBody>

      {/* Ubah harga jual */}
      <Sheet open={priceOpen} onClose={() => setPriceOpen(false)} title="Ubah Harga Jual">
        <div className="space-y-4">
          <Field label="Harga jual" hint="Tampil di katalog publik bila diisi.">
            <RpInput value={hargaJual} onChange={setHargaJual} />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await db.units.update(unit.id, { hargaJual });
                await logAudit(
                  user, "harga", "unit", unit.id,
                  `${unit.kode}: harga jual → ${rp(hargaJual)}`,
                );
                toast("Harga jual diperbarui");
                setPriceOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan
          </Button>
        </div>
      </Sheet>

      {/* Jual */}
      <Sheet open={sellOpen} onClose={() => setSellOpen(false)} title={`Jual ${unit.kode}`}>
        <div className="space-y-4">
          <Field label="Harga jual final" required>
            <RpInput
              value={sale.soldPrice}
              onChange={(n) => setSale({ ...sale, soldPrice: n })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nama pembeli">
              <Input
                value={sale.buyerName}
                onChange={(e) => setSale({ ...sale, buyerName: e.target.value })}
              />
            </Field>
            <Field label="No. WA pembeli">
              <Input
                inputMode="tel"
                value={sale.buyerPhone}
                onChange={(e) => setSale({ ...sale, buyerPhone: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Garansi toko (hari)">
            <Input
              inputMode="numeric"
              value={sale.garansiHari}
              onChange={(e) =>
                setSale({
                  ...sale,
                  garansiHari: Number(e.target.value.replace(/\D/g, "")) || 0,
                })
              }
            />
          </Field>
          <Field label="Metode pembayaran">
            <MethodPicker
              value={sale.method}
              onChange={(m) => setSale({ ...sale, method: m })}
            />
          </Field>
          {money && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm">
              <Row label="Modal">{rp(unit.hargaBeli)}</Row>
              <Row label="Margin" strong>
                <span className="text-emerald-600">
                  +{rp(Math.max(0, sale.soldPrice - unit.hargaBeli))}
                </span>
              </Row>
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={sale.soldPrice <= 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await sellUnit(user, unit, sale);
                toast(`${unit.kode} terjual — ${rp(sale.soldPrice)}`);
                setSellOpen(false);
                nav(`/app/nota/unit/${unit.id}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Catat Penjualan
          </Button>
        </div>
      </Sheet>

      {/* Retur */}
      <Sheet open={returOpen} onClose={() => setReturOpen(false)} title={`Retur ${unit.kode}`}>
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <Row label="Dijual seharga">{rp(unit.soldPrice ?? 0)}</Row>
            <Row label="Pembeli">{unit.buyerName || "-"}</Row>
          </div>
          <Field
            label="Refund ke pembeli"
            required
            hint="Boleh lebih kecil dari harga jual bila dipotong biaya."
          >
            <RpInput
              value={retur.refund}
              onChange={(n) => setRetur({ ...retur, refund: n })}
            />
          </Field>
          <Field label="Metode refund">
            <MethodPicker
              value={retur.method}
              onChange={(m) => setRetur({ ...retur, method: m })}
            />
          </Field>
          <Field label="Alasan retur" required>
            <Textarea
              value={retur.alasan}
              onChange={(e) => setRetur({ ...retur, alasan: e.target.value })}
              placeholder="Klaim garansi toko: layar bergaris setelah 3 hari…"
            />
          </Field>
          <p className="text-xs text-slate-400">
            Unit kembali ke stok, refund tercatat sebagai kas keluar, dan margin
            bulan ini terkoreksi otomatis di laporan.
          </p>
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            disabled={!retur.alasan.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await returUnit(user, unit, retur);
                toast(`${unit.kode} kembali ke stok`);
                setReturOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Proses Retur
          </Button>
        </div>
      </Sheet>
    </>
  );
}
