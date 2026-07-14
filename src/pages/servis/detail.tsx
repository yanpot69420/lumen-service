import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  MessageCircle,
  Printer,
  Plus,
  Trash2,
  Ban,
  Pencil,
  ShieldCheck,
  Tag as TagIcon,
  HandCoins,
} from "lucide-react";
import { db } from "@/db/db";
import type { CashMethod, Ticket } from "@/db/types";
import {
  NEXT_ACTIONS,
  GARANSI_SERVIS_HARI,
  changeStatus,
  createGaransiClaim,
  diambilAt,
  payPiutang,
  removePart,
  reviseJasa,
  ticketSisa,
  ticketTotal,
  updateTicketInfo,
  usePart,
} from "@/db/tickets";
import { getSetting, getWaTemplates } from "@/db/settings";
import { useUser } from "@/auth/session";
import { rp, fmtDateTime, daysSince } from "@/lib/format";
import { fillTemplate, waLink } from "@/lib/wa";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { TicketStatusTag, Tag } from "@/components/ui/status-tag";
import { MethodPicker } from "@/components/method-picker";
import { PhotoManager } from "@/components/photos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Row } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const KELENGKAPAN = ["Charger", "Kartu SIM", "Memory Card", "Casing", "SIM Tray"];

export function ServisDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const nav = useNavigate();
  const toast = useToast();
  const ticket = useLiveQuery(() => db.tickets.get(id!), [id]);
  const parts = useLiveQuery(() => db.parts.orderBy("nama").toArray(), []);
  const sourceTicket = useLiveQuery(
    () => (ticket?.garansiDari ? db.tickets.get(ticket.garansiDari) : undefined),
    [ticket?.garansiDari],
  );

  const [statusSheet, setStatusSheet] = useState<null | {
    to: Ticket["status"];
    label: string;
  }>(null);
  const [biayaJasa, setBiayaJasa] = useState(0);
  const [note, setNote] = useState("");
  const [bayar, setBayar] = useState(0);
  const [method, setMethod] = useState<CashMethod>("tunai");
  const [partSheet, setPartSheet] = useState(false);
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState(1);
  const [cancelSheet, setCancelSheet] = useState(false);
  const [refundDp, setRefundDp] = useState(true);
  const [editSheet, setEditSheet] = useState(false);
  const [editF, setEditF] = useState({
    customerName: "",
    phone: "",
    brand: "",
    model: "",
    keluhan: "",
    kelengkapan: [] as string[],
  });
  const [revisiSheet, setRevisiSheet] = useState(false);
  const [revisiJasa, setRevisiJasa] = useState(0);
  const [garansiSheet, setGaransiSheet] = useState(false);
  const [piutangSheet, setPiutangSheet] = useState(false);
  const [bayarPiutang, setBayarPiutang] = useState(0);
  const [busy, setBusy] = useState(false);

  if (!ticket) return null;

  const total = ticketTotal(ticket);
  const sisa = ticketSisa(ticket);
  const done = ticket.status === "diambil" || ticket.status === "batal";
  const canRevise = ["konfirmasi", "dikerjakan", "selesai"].includes(ticket.status);
  const ambilAt = diambilAt(ticket);
  const garansiHariLewat = ambilAt ? daysSince(ambilAt) : 0;

  async function doStatus() {
    if (!ticket || !statusSheet || busy) return;
    setBusy(true);
    try {
      await changeStatus(user, ticket, statusSheet.to, {
        note: note.trim() || undefined,
        biayaJasa:
          statusSheet.to === "konfirmasi" && biayaJasa > 0
            ? biayaJasa
            : undefined,
        bayar: statusSheet.to === "diambil" ? bayar : undefined,
        method: statusSheet.to === "diambil" ? method : undefined,
      });
      toast(`Status → ${statusSheet.label}`);
      setStatusSheet(null);
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  async function sendWa() {
    if (!ticket) return;
    const tpls = await getWaTemplates();
    const toko = await getSetting("storeName");
    const text = fillTemplate(tpls[ticket.status], {
      nama: ticket.customerName,
      nota: ticket.noNota,
      tipe: `${ticket.brand} ${ticket.model}`.trim(),
      keluhan: ticket.keluhan,
      estimasi: rp(total),
      toko,
    });
    window.open(waLink(ticket.phone, text), "_blank");
  }

  return (
    <>
      <PageHeader
        title={ticket.noNota}
        back={
          <Link to="/app/servis" className="text-slate-400 hover:text-slate-600">
            <ArrowLeft className="size-5" />
          </Link>
        }
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={sendWa}>
              <MessageCircle /> WA
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nav(`/app/nota/servis/${ticket.id}?label=1`)}
            >
              <TagIcon /> Label
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nav(`/app/nota/servis/${ticket.id}`)}
            >
              <Printer /> Nota
            </Button>
          </div>
        }
      />
      <PageBody>
        {/* Ringkasan */}
        <Card>
          <CardContent>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold">
                  {ticket.brand} {ticket.model}
                </p>
                <p className="text-sm text-slate-500">
                  {ticket.customerName}
                  {ticket.phone && ` · ${ticket.phone}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {ticket.garansiDari && (
                  <Tag className="bg-violet-100 text-violet-800">
                    Garansi{sourceTicket ? ` · ${sourceTicket.noNota}` : ""}
                  </Tag>
                )}
                <TicketStatusTag status={ticket.status} />
                <button
                  onClick={() => {
                    setEditF({
                      customerName: ticket.customerName,
                      phone: ticket.phone,
                      brand: ticket.brand,
                      model: ticket.model,
                      keluhan: ticket.keluhan,
                      kelengkapan: ticket.kelengkapan,
                    });
                    setEditSheet(true);
                  }}
                  className="text-slate-300 hover:text-brand-500"
                  aria-label="Edit data nota"
                >
                  <Pencil className="size-4" />
                </button>
              </div>
            </div>
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
              {ticket.keluhan}
            </p>
            {ticket.kelengkapan.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Kelengkapan: {ticket.kelengkapan.join(", ")}
              </p>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2">
              <Row label={ticket.biayaJasa ? "Biaya jasa" : "Estimasi biaya"}>
                <span className="flex items-center justify-end gap-2">
                  {rp(ticket.biayaJasa || ticket.estimasi)}
                  {canRevise && (
                    <button
                      onClick={() => {
                        setRevisiJasa(ticket.biayaJasa || ticket.estimasi);
                        setNote("");
                        setRevisiSheet(true);
                      }}
                      className="text-xs font-medium text-brand-600 underline"
                    >
                      revisi
                    </button>
                  )}
                </span>
              </Row>
              {ticket.partsUsed.map((p, i) => (
                <Row key={i} label={`${p.qty}× ${p.nama}`}>
                  <span className="flex items-center justify-end gap-2">
                    {rp(p.harga * p.qty)}
                    {!done && (
                      <button
                        onClick={() => removePart(user, ticket, i)}
                        className="text-slate-300 hover:text-red-500"
                        aria-label="Hapus part"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                </Row>
              ))}
              <Row label="Total" strong>
                {rp(total)}
              </Row>
              {ticket.dp > 0 && <Row label="DP">− {rp(ticket.dp)}</Row>}
              {!done && (
                <Row label="Sisa bayar" strong>
                  <span className={sisa > 0 ? "text-brand-600" : "text-emerald-600"}>
                    {rp(sisa)}
                  </span>
                </Row>
              )}
              {(ticket.piutang ?? 0) > 0 && (
                <Row label="Piutang" strong>
                  <span className="text-red-600">{rp(ticket.piutang!)}</span>
                </Row>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Piutang */}
        {(ticket.piutang ?? 0) > 0 && (
          <Button
            variant="accent"
            size="lg"
            className="w-full"
            onClick={() => {
              setBayarPiutang(ticket.piutang!);
              setMethod("tunai");
              setPiutangSheet(true);
            }}
          >
            <HandCoins /> Terima Pembayaran Piutang — {rp(ticket.piutang!)}
          </Button>
        )}

        {/* Klaim garansi */}
        {ticket.status === "diambil" && !ticket.garansiDari && (
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setNote("");
              setGaransiSheet(true);
            }}
          >
            <ShieldCheck /> Klaim Garansi
          </Button>
        )}

        {/* Aksi status */}
        {!done && (
          <div className="flex flex-wrap gap-2">
            {NEXT_ACTIONS[ticket.status].map((a) => (
              <Button
                key={a.to}
                variant="accent"
                size="lg"
                className="flex-1"
                onClick={() => {
                  setBiayaJasa(ticket.biayaJasa || ticket.estimasi);
                  if (a.to === "diambil") {
                    setBayar(sisa);
                    setMethod("tunai");
                  }
                  setStatusSheet(a);
                }}
              >
                {a.label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setNote("");
                setRefundDp(true);
                setMethod("tunai");
                setCancelSheet(true);
              }}
            >
              <Ban /> Batal
            </Button>
          </div>
        )}

        {/* Sparepart */}
        {!done && (
          <Card>
            <CardHeader>
              <CardTitle>Sparepart dipakai</CardTitle>
              <Button variant="secondary" size="sm" onClick={() => setPartSheet(true)}>
                <Plus /> Tambah
              </Button>
            </CardHeader>
            <CardContent className="pt-2 text-xs text-slate-400">
              Stok berkurang otomatis dan biayanya masuk ke total nota.
            </CardContent>
          </Card>
        )}

        {/* Foto */}
        <Card>
          <CardHeader>
            <CardTitle>Foto kondisi</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoManager refType="ticket" refId={ticket.id} canDelete={!done} />
          </CardContent>
        </Card>

        {/* Riwayat */}
        <Card>
          <CardHeader>
            <CardTitle>Riwayat status</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {[...ticket.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <div className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" />
                  <div>
                    <TicketStatusTag status={h.status} />
                    <p className="mt-0.5 text-xs text-slate-400">
                      {fmtDateTime(h.at)} · {h.by}
                      {h.note && ` — ${h.note}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </PageBody>

      {/* Sheet transisi status */}
      <Sheet
        open={!!statusSheet}
        onClose={() => setStatusSheet(null)}
        title={statusSheet?.label ?? ""}
      >
        <div className="space-y-4">
          {statusSheet?.to === "konfirmasi" && (
            <Field
              label="Biaya jasa final"
              hint="Harga yang diajukan ke pelanggan (di luar sparepart)."
            >
              <RpInput value={biayaJasa} onChange={setBiayaJasa} />
            </Field>
          )}
          {statusSheet?.to === "diambil" && (
            <>
              <div className="rounded-xl bg-emerald-50 p-4 text-sm">
                <Row label="Total">{rp(total)}</Row>
                {ticket.dp > 0 && <Row label="DP sudah dibayar">− {rp(ticket.dp)}</Row>}
                <Row label="Sisa tagihan" strong>
                  {rp(sisa)}
                </Row>
              </div>
              <Field
                label="Dibayar sekarang"
                hint="Isi lebih kecil dari sisa tagihan bila pelanggan bayar sebagian — sisanya tercatat sebagai piutang."
              >
                <RpInput
                  value={bayar}
                  onChange={(n) => setBayar(Math.min(n, sisa))}
                />
              </Field>
              {bayar < sisa && (
                <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
                  Piutang: {rp(sisa - bayar)} — tercatat di nota & laporan.
                </p>
              )}
              <Field label="Metode pembayaran">
                <MethodPicker value={method} onChange={setMethod} />
              </Field>
            </>
          )}
          <Field label="Catatan (opsional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button size="lg" className="w-full" disabled={busy} onClick={doStatus}>
            {statusSheet?.label}
          </Button>
        </div>
      </Sheet>

      {/* Sheet tambah part */}
      <Sheet open={partSheet} onClose={() => setPartSheet(false)} title="Pakai Sparepart">
        <div className="space-y-4">
          <Field label="Sparepart" required>
            <Select value={partId} onChange={(e) => setPartId(e.target.value)}>
              <option value="">— pilih —</option>
              {parts?.map((p) => (
                <option key={p.id} value={p.id} disabled={p.stok <= 0}>
                  {p.nama} (stok {p.stok}) — {rp(p.hargaJual)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Jumlah">
            <Input
              inputMode="numeric"
              value={qty}
              onChange={(e) =>
                setQty(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))
              }
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={!partId || busy}
            onClick={async () => {
              if (!ticket) return;
              setBusy(true);
              try {
                await usePart(user, ticket, partId, qty);
                toast("Sparepart ditambahkan");
                setPartSheet(false);
                setPartId("");
                setQty(1);
              } catch (e) {
                toast(e instanceof Error ? e.message : "Gagal", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Tambahkan ke Nota
          </Button>
        </div>
      </Sheet>

      {/* Sheet batal */}
      <Sheet open={cancelSheet} onClose={() => setCancelSheet(false)} title="Batalkan Servis">
        <div className="space-y-4">
          <Field label="Alasan pembatalan" required>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pelanggan tidak setuju harga / minta unit kembali…"
            />
          </Field>
          {ticket.dp > 0 && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-4">
              <p className="text-sm font-semibold">DP {rp(ticket.dp)} diapakan?</p>
              {(
                [
                  [true, "Dikembalikan ke pelanggan (kas keluar tercatat)"],
                  [false, "Hangus sebagai biaya pengecekan (tetap jadi pendapatan)"],
                ] as const
              ).map(([val, label]) => (
                <label key={String(val)} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={refundDp === val}
                    onChange={() => setRefundDp(val)}
                  />
                  {label}
                </label>
              ))}
              {refundDp && (
                <MethodPicker value={method} onChange={setMethod} />
              )}
            </div>
          )}
          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            disabled={!note.trim() || busy}
            onClick={async () => {
              if (!ticket) return;
              setBusy(true);
              try {
                await changeStatus(user, ticket, "batal", {
                  note: note.trim(),
                  refundDp: ticket.dp > 0 ? refundDp : undefined,
                  method,
                });
                toast("Servis dibatalkan", "info");
                setCancelSheet(false);
                setNote("");
              } finally {
                setBusy(false);
              }
            }}
          >
            Batalkan Servis
          </Button>
        </div>
      </Sheet>

      {/* Sheet edit info */}
      <Sheet open={editSheet} onClose={() => setEditSheet(false)} title="Edit Data Nota">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nama pelanggan" required>
              <Input
                value={editF.customerName}
                onChange={(e) => setEditF({ ...editF, customerName: e.target.value })}
              />
            </Field>
            <Field label="No. WA">
              <Input
                inputMode="tel"
                value={editF.phone}
                onChange={(e) => setEditF({ ...editF, phone: e.target.value })}
              />
            </Field>
            <Field label="Merk" required>
              <Input
                value={editF.brand}
                onChange={(e) => setEditF({ ...editF, brand: e.target.value })}
              />
            </Field>
            <Field label="Tipe">
              <Input
                value={editF.model}
                onChange={(e) => setEditF({ ...editF, model: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Keluhan" required>
            <Textarea
              value={editF.keluhan}
              onChange={(e) => setEditF({ ...editF, keluhan: e.target.value })}
            />
          </Field>
          <Field label="Kelengkapan">
            <div className="flex flex-wrap gap-1.5">
              {KELENGKAPAN.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setEditF((f) => ({
                      ...f,
                      kelengkapan: f.kelengkapan.includes(k)
                        ? f.kelengkapan.filter((x) => x !== k)
                        : [...f.kelengkapan, k],
                    }))
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium",
                    editF.kelengkapan.includes(k)
                      ? "bg-brand-950 text-white"
                      : "border border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </Field>
          <p className="text-xs text-slate-400">
            Perubahan tercatat di audit log. Nominal tidak bisa diubah dari sini.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={!editF.customerName.trim() || !editF.brand.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateTicketInfo(user, ticket, editF);
                toast("Data nota diperbarui");
                setEditSheet(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan Perubahan
          </Button>
        </div>
      </Sheet>

      {/* Sheet revisi harga */}
      <Sheet open={revisiSheet} onClose={() => setRevisiSheet(false)} title="Revisi Harga Jasa">
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <Row label="Harga sekarang" strong>
              {rp(ticket.biayaJasa || ticket.estimasi)}
            </Row>
          </div>
          <Field label="Harga jasa baru" required>
            <RpInput value={revisiJasa} onChange={setRevisiJasa} />
          </Field>
          <Field label="Alasan revisi" required hint="Contoh: setelah dibongkar ternyata IC power ikut rusak.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="text-xs text-amber-700">
            Sarankan konfirmasi ulang harga ke pelanggan via WA setelah revisi.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={!note.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await reviseJasa(user, ticket, revisiJasa, note.trim());
                toast("Harga direvisi & tercatat");
                setRevisiSheet(false);
                setNote("");
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan Revisi
          </Button>
        </div>
      </Sheet>

      {/* Sheet klaim garansi */}
      <Sheet open={garansiSheet} onClose={() => setGaransiSheet(false)} title="Klaim Garansi">
        <div className="space-y-4">
          <div
            className={cn(
              "rounded-xl p-4 text-sm",
              garansiHariLewat <= GARANSI_SERVIS_HARI
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800",
            )}
          >
            Unit diambil {garansiHariLewat} hari lalu — garansi servis{" "}
            {GARANSI_SERVIS_HARI} hari{" "}
            {garansiHariLewat <= GARANSI_SERVIS_HARI
              ? "masih berlaku."
              : "sudah LEWAT. Lanjutkan hanya atas kebijakan konter."}
          </div>
          <Field label="Keluhan klaim" required>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Keluhan yang sama muncul lagi / hasil perbaikan bermasalah…"
            />
          </Field>
          <p className="text-xs text-slate-400">
            Nota baru dibuat dengan biaya Rp0, tertaut ke nota ini, dan masuk
            antrean seperti biasa.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={!note.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const t = await createGaransiClaim(user, ticket, note.trim());
                toast(`Nota garansi ${t.noNota} dibuat`);
                setGaransiSheet(false);
                setNote("");
                nav(`/app/servis/${t.id}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Buat Nota Garansi
          </Button>
        </div>
      </Sheet>

      {/* Sheet bayar piutang */}
      <Sheet open={piutangSheet} onClose={() => setPiutangSheet(false)} title="Pembayaran Piutang">
        <div className="space-y-4">
          <div className="rounded-xl bg-red-50 p-4 text-sm">
            <Row label="Piutang saat ini" strong>
              <span className="text-red-700">{rp(ticket.piutang ?? 0)}</span>
            </Row>
          </div>
          <Field label="Dibayar sekarang" required>
            <RpInput
              value={bayarPiutang}
              onChange={(n) => setBayarPiutang(Math.min(n, ticket.piutang ?? 0))}
            />
          </Field>
          <Field label="Metode pembayaran">
            <MethodPicker value={method} onChange={setMethod} />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={bayarPiutang <= 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await payPiutang(user, ticket, bayarPiutang, method);
                toast("Pembayaran piutang tercatat");
                setPiutangSheet(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Catat Pembayaran
          </Button>
        </div>
      </Sheet>
    </>
  );
}
