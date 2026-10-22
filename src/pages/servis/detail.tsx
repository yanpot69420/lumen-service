import { can } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { MethodPicker } from "@/components/method-picker";
import { PhotoManager } from "@/components/photos";
import { useServiceAction } from "@/components/use-service-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, RpInput, Select, Textarea } from "@/components/ui/field";
import { Row } from "@/components/ui/misc";
import { Modal } from "@/components/ui/dialog";
import { Tag, TicketStatusTag } from "@/components/ui/status-tag";
import { db } from "@/db/db";
import { getSetting, getWaTemplates } from "@/db/settings";
import {
  GARANSI_SERVIS_HARI,
  NEXT_ACTIONS,
  changeStatus,
  createGaransiClaim,
  diambilAt,
  payPiutang,
  removePart,
  reviseJasa,
  submitServicePrice,
  ticketJasa,
  ticketSisa,
  ticketTotal,
  updateTicketInfo,
  usePart,
} from "@/db/tickets";
import type { CashMethod, Ticket } from "@/db/types";
import { cn } from "@/lib/cn";
import { daysSince, fmtDateTime, rp } from "@/lib/format";
import { fillTemplate, waLink } from "@/lib/wa";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Ban,
  HandCoins,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  ShieldCheck,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

const KELENGKAPAN = ["Charger", "Kartu SIM", "Memory Card", "Casing", "SIM Tray"];

export function ServisDetailPage() {
  const { id } = useParams();
  const user = useUser();
  const nav = useNavigate();
  const { run } = useServiceAction();
  const ticket = useLiveQuery(async () => (await db.tickets.get(id!)) ?? null, [id]);
  const parts = useLiveQuery(() => db.parts.orderBy("nama").toArray(), []);
  const sourceTicket = useLiveQuery(
    () => (ticket?.garansiDari ? db.tickets.get(ticket.garansiDari) : undefined),
    [ticket?.garansiDari],
  );

  const [statusModal, setStatusModal] = useState<null | {
    to: Ticket["status"];
    label: string;
    ticket: Ticket;
  }>(null);
  const [biayaJasa, setBiayaJasa] = useState(0);
  const [langsungKerjakan, setLangsungKerjakan] = useState(false);
  const [note, setNote] = useState("");
  const [bayar, setBayar] = useState(0);
  const [method, setMethod] = useState<CashMethod>("tunai");
  const [partModal, setPartModal] = useState(false);
  const [partId, setPartId] = useState("");
  const selectedPart = parts?.find((part) => part.id === partId);
  const [qty, setQty] = useState(1);
  const [cancelModal, setCancelModal] = useState<Ticket | null>(null);
  const [refundDp, setRefundDp] = useState(true);
  const [editModal, setEditModal] = useState<Ticket | null>(null);
  const [editF, setEditF] = useState({
    customerName: "",
    phone: "",
    brand: "",
    model: "",
    keluhan: "",
    kelengkapan: [] as string[],
  });
  const [revisiModal, setRevisiModal] = useState<Ticket | null>(null);
  const [revisiJasa, setRevisiJasa] = useState(0);
  const [garansiModal, setGaransiModal] = useState(false);
  const [piutangModal, setPiutangModal] = useState<Ticket | null>(null);
  const [bayarPiutang, setBayarPiutang] = useState(0);
  const [busy, setBusy] = useState(false);

  if (ticket === undefined) return <PageBody>Memuat nota…</PageBody>;
  if (ticket === null) return <PageBody>Nota tidak ditemukan. <Link to="/app/servis" className="underline">Kembali ke daftar servis</Link></PageBody>;

  const total = ticketTotal(ticket);
  const sisa = ticketSisa(ticket);
  const done = ticket.status === "diambil" || ticket.status === "batal";
  const canRevise = ["konfirmasi", "dikerjakan", "selesai"].includes(ticket.status);
  const ambilAt = diambilAt(ticket);
  const garansiHariLewat = ambilAt ? daysSince(ambilAt) : 0;

  async function doStatus() {
    if (!ticket || !statusModal || busy) return;
    setBusy(true);
    try {
      await run(async () => {
        if (statusModal.to === "konfirmasi") {
          await submitServicePrice(user, statusModal.ticket, biayaJasa, langsungKerjakan, note.trim() || undefined);
        } else {
          await changeStatus(user, statusModal.ticket, statusModal.to, {
            note: note.trim() || undefined,
            bayar: statusModal.to === "diambil" ? bayar : undefined,
            method: statusModal.to === "diambil" ? method : undefined,
          });
        }
      }, {
        pending: "Menyimpan status servis…",
        success: statusModal.to === "konfirmasi" && langsungKerjakan
          ? "Harga disimpan, servis langsung dikerjakan"
          : `Status servis: ${statusModal.label}`,
      });
      setStatusModal(null);
      setNote("");
    } catch {
      // Snackbar explains the error; keep the form open so it can be corrected.
    } finally {
      setBusy(false);
    }
  }

  async function doRemovePart(index: number) {
    if (!ticket || busy) return;
    setBusy(true);
    try {
      await run(() => removePart(user, ticket, index), {
        pending: "Menghapus sparepart dari nota…",
        success: "Sparepart dihapus dan stok dikembalikan",
      });
    } catch {
      // The action hook displays the failure without changing the nota.
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
        subtitle="Detail perangkat, biaya servis, dan perkembangan pengerjaan."
        back={
          <Link to="/app/servis" aria-label="Kembali ke daftar servis" className="inline-flex size-11 items-center justify-center rounded-2xl bg-white text-slate-600 hover:text-slate-900 lg:size-auto lg:rounded-none lg:bg-transparent lg:text-slate-400">
            <ArrowLeft className="size-5" />
          </Link>
        }
        action={
          <div className="hidden gap-2 lg:flex">
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
        <div className="grid grid-cols-3 gap-2 lg:hidden" aria-label="Bagikan dan cetak nota">
          <Button variant="outline" className="h-12 rounded-2xl border-transparent text-xs" onClick={sendWa}><MessageCircle /> WhatsApp</Button>
          <Button variant="outline" className="h-12 rounded-2xl border-transparent text-xs" onClick={() => nav(`/app/nota/servis/${ticket.id}?label=1`)}><TagIcon /> Label</Button>
          <Button variant="outline" className="h-12 rounded-2xl border-transparent text-xs" onClick={() => nav(`/app/nota/servis/${ticket.id}`)}><Printer /> Cetak nota</Button>
        </div>
        <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
        <div className="min-w-0 space-y-4 lg:space-y-5">
        {/* Ringkasan */}
        <Card className="overflow-hidden rounded-[1.75rem] border-transparent shadow-none lg:rounded-[22px] lg:border-slate-200/80">
          <CardContent className="lg:p-6">
            <div className="-mx-4 -mt-4 flex flex-col gap-4 bg-brand-950 p-5 text-white lg:-mx-6 lg:-mt-6 lg:flex-row lg:items-start lg:justify-between lg:gap-3 lg:p-6">
              <div className="min-w-0">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Perangkat pelanggan</p>
                <p className="break-words text-2xl font-bold leading-tight lg:text-[1.5rem]">
                  {ticket.brand} {ticket.model}
                </p>
                <p className="mt-2 break-words text-sm leading-relaxed text-white/65">
                  {ticket.customerName}
                  {ticket.phone && ` · ${ticket.phone}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {ticket.garansiDari && (
                  <Tag className="bg-brand-100 text-brand-800">
                    Garansi{sourceTicket ? ` · ${sourceTicket.noNota}` : ""}
                  </Tag>
                )}
                <TicketStatusTag status={ticket.status} />
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditF({
                      customerName: ticket.customerName,
                      phone: ticket.phone,
                      brand: ticket.brand,
                      model: ticket.model,
                      keluhan: ticket.keluhan,
                      kelengkapan: ticket.kelengkapan,
                    });
                    setEditModal(ticket);
                  }}
                  className="ml-auto inline-flex size-11 items-center justify-center rounded-2xl bg-white/10 text-white hover:text-accent-400 lg:ml-0 lg:size-9 lg:rounded-xl"
                  aria-label="Edit data nota"
                >
                  <Pencil className="size-4" />
                </button>
              </div>
            </div>
            <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:mt-5">Keluhan perangkat</p>
            <p className="rounded-2xl bg-slate-50 p-3 text-sm leading-relaxed lg:rounded-xl lg:p-4">
              {ticket.keluhan}
            </p>
            {ticket.kelengkapan.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Kelengkapan: {ticket.kelengkapan.join(", ")}
              </p>
            )}
            <div className="mt-4 border-t border-slate-100 pt-3 lg:mt-5 lg:pt-4">
              <Row label={(ticket.hargaFinal ?? ticket.biayaJasa > 0) ? "Biaya jasa" : "Estimasi biaya"}>
                <span className="flex items-center justify-end gap-2">
                  {rp(ticketJasa(ticket))}
                  {canRevise && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setRevisiJasa(ticketJasa(ticket));
                        setNote("");
                        setRevisiModal(ticket);
                      }}
                      className="inline-flex min-h-11 items-center rounded-xl bg-slate-50 px-3 text-xs font-semibold text-brand-600 lg:min-h-0 lg:rounded-none lg:bg-transparent lg:px-0 lg:font-medium lg:underline"
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
                        onClick={() => void doRemovePart(i)}
                        disabled={busy}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 hover:text-red-700 lg:size-auto lg:rounded-none lg:bg-transparent lg:text-slate-300 lg:hover:text-red-500"
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
                  <span className={sisa > 0 ? "text-brand-600" : "text-brand-600"}>
                    {rp(sisa)}
                  </span>
                </Row>
              )}
              {(ticket.piutang ?? 0) > 0 && (
                <Row label="Piutang" strong>
                  <span className="text-accent-700">{rp(ticket.piutang!)}</span>
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
            className="h-auto min-h-12 w-full py-3 text-sm leading-relaxed lg:h-12 lg:py-0 lg:text-base"
            disabled={busy}
            onClick={() => {
              setBayarPiutang(ticket.piutang!);
              setMethod("tunai");
              setPiutangModal(ticket);
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
            disabled={busy}
            onClick={() => {
              setNote("");
              setGaransiModal(true);
            }}
          >
            <ShieldCheck /> Klaim Garansi
          </Button>
        )}

        {/* Sparepart */}
        {!done && (
          <Card className="rounded-[1.5rem] border-transparent shadow-none lg:rounded-[22px] lg:border-slate-200/80">
            <CardHeader className="lg:px-6 lg:pt-5">
              <CardTitle>Sparepart dipakai</CardTitle>
              <Button variant="secondary" size="sm" className="h-11 rounded-2xl px-4 lg:h-8 lg:rounded-xl lg:px-3" disabled={busy} onClick={() => setPartModal(true)}>
                <Plus /> Tambah
              </Button>
            </CardHeader>
            <CardContent className="pt-2 text-xs leading-relaxed text-slate-400 lg:px-6 lg:pb-5">
              Stok berkurang otomatis dan biayanya masuk ke total nota.
            </CardContent>
          </Card>
        )}

        {/* Aksi status */}
        {!done && (
          <section className="rounded-[1.5rem] bg-white p-4 lg:rounded-[22px] lg:border lg:border-slate-200/80 lg:p-6" aria-label="Tindakan servis">
            <p className="mb-3 text-xs font-bold text-brand-950 lg:text-sm">Langkah berikutnya</p>
            <p className="mb-4 hidden text-xs leading-relaxed text-slate-500 lg:block">Lanjutkan proses setelah kondisi perangkat dan persetujuan pelanggan sudah sesuai.</p>
          <div className="flex flex-wrap gap-2">
            {NEXT_ACTIONS[ticket.status].filter((a) => a.to !== "diambil" || can(user.role, "sell")).map((a) => (
              <Button
                key={a.to}
                variant="accent"
                size="lg"
                className="min-w-0 flex-1 rounded-2xl px-3 text-sm lg:rounded-xl lg:px-5 lg:text-base"
                disabled={busy}
                onClick={() => {
                  setBiayaJasa(ticketJasa(ticket));
                  setLangsungKerjakan(false);
                  setNote("");
                  if (a.to === "diambil") {
                    setBayar(sisa);
                    setMethod("tunai");
                  }
                  setStatusModal({ ...a, ticket });
                }}
              >
                {a.label}
              </Button>
            ))}
            {can(user.role, "sell") && <Button
              variant="outline"
              size="lg"
              className="rounded-2xl px-4 text-sm lg:rounded-xl lg:px-5 lg:text-base"
              disabled={busy}
              onClick={() => {
                setNote("");
                setRefundDp(true);
                setMethod("tunai");
                setCancelModal(ticket);
              }}
            >
              <Ban /> Batal
            </Button>}
          </div>
          </section>
        )}
        </div>
        <div className="min-w-0 space-y-4 lg:space-y-5">
        {/* Foto */}
        <Card className="rounded-[1.5rem] border-transparent shadow-none lg:rounded-[22px] lg:border-slate-200/80">
          <CardHeader className="lg:px-6 lg:pt-5">
            <CardTitle>Foto kondisi</CardTitle>
          </CardHeader>
          <CardContent className="lg:p-6">
            <PhotoManager refType="ticket" refId={ticket.id} canDelete={!done} serviceUndo disabled={busy} onBusyChange={setBusy} />
          </CardContent>
        </Card>

        {/* Riwayat */}
        <Card className="rounded-[1.5rem] border-transparent shadow-none lg:rounded-[22px] lg:border-slate-200/80">
          <CardHeader className="lg:px-6 lg:pt-5">
            <CardTitle>Riwayat status</CardTitle>
          </CardHeader>
          <CardContent className="lg:p-6">
            <ol className="space-y-4 lg:space-y-5">
              {[...ticket.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <div className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-50"><span className="size-1.5 rounded-full bg-brand-500" /></div>
                  <div>
                    <TicketStatusTag status={h.status} />
                    <p className="mt-1 text-xs leading-relaxed text-slate-400 lg:mt-0.5">
                      {fmtDateTime(h.at)} · {h.by}
                      {h.note && ` — ${h.note}`}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        </div>
        </div>
      </PageBody>

      {/* Modal transisi status */}
      <Modal
        busy={busy}
        open={!!statusModal}
        onClose={() => setStatusModal(null)}
        title={statusModal?.label ?? ""}
      >
        <div className="space-y-4">
          {statusModal?.to === "konfirmasi" && (
            <>
              <Field label="Biaya jasa final" hint="Harga yang diajukan ke pelanggan (di luar sparepart).">
                <RpInput value={biayaJasa} onChange={setBiayaJasa} />
              </Field>
              <div className="rounded-xl bg-slate-50 p-4 text-sm">
                <Row label="Biaya jasa">{rp(biayaJasa)}</Row>
                <Row label="Sparepart">{rp(ticket.partsUsed.reduce((sum, p) => sum + p.harga * p.qty, 0))}</Row>
                <Row label="Total biaya" strong>{rp(ticketTotal({ ...ticket, biayaJasa, hargaFinal: true }))}</Row>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent-600" checked={langsungKerjakan} onChange={(e) => setLangsungKerjakan(e.target.checked)} />
                <span>
                  <span className="block font-medium">Langsung kerjakan</span>
                  <span className="mt-1 block text-xs text-slate-500">Pilih jika pelanggan sudah menyetujui biaya. Setelah disimpan, status langsung menjadi Dikerjakan.</span>
                </span>
              </label>
            </>
          )}
          {statusModal?.to === "diambil" && (
            <>
              <div className="rounded-xl bg-brand-50 p-4 text-sm">
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
            {statusModal?.to === "konfirmasi" && langsungKerjakan ? "Simpan Harga & Kerjakan" : statusModal?.label}
          </Button>
        </div>
      </Modal>

      {/* Modal tambah part */}
      <Modal busy={busy} open={partModal} onClose={() => setPartModal(false)} title="Pakai Sparepart">
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
          {selectedPart && <p className="rounded-xl bg-slate-50 p-3 text-sm [overflow-wrap:anywhere]">{selectedPart.nama}</p>}
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
              if (!ticket || busy) return;
              setBusy(true);
              try {
                await run(() => usePart(user, ticket, partId, qty), {
                  pending: "Menambahkan sparepart ke nota…",
                  success: "Sparepart ditambahkan dan stok diperbarui",
                });
                setPartModal(false);
                setPartId("");
                setQty(1);
              } catch {
                // Keep the selected part and quantity available for correction.
              } finally {
                setBusy(false);
              }
            }}
          >
            Tambahkan ke Nota
          </Button>
        </div>
      </Modal>

      {/* Modal batal */}
      <Modal busy={busy} open={!!cancelModal} onClose={() => setCancelModal(null)} title="Batalkan Servis">
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
              if (!ticket || busy) return;
              setBusy(true);
              try {
                await run(() => changeStatus(user, cancelModal ?? ticket, "batal", {
                  note: note.trim(),
                  refundDp: ticket.dp > 0 ? refundDp : undefined,
                  method,
                }), {
                  pending: "Membatalkan servis…",
                  success: "Servis dibatalkan",
                });
                setCancelModal(null);
                setNote("");
              } catch {
                // The action hook displays the failure and preserves this form.
              } finally {
                setBusy(false);
              }
            }}
          >
            Batalkan Servis
          </Button>
        </div>
      </Modal>

      {/* Modal edit info */}
      <Modal busy={busy} open={!!editModal} onClose={() => setEditModal(null)} title="Edit Data Nota">
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
              if (busy) return;
              setBusy(true);
              try {
                await run(() => updateTicketInfo(user, editModal ?? ticket, editF), {
                  pending: "Menyimpan perubahan nota…",
                  success: "Data nota diperbarui",
                });
                setEditModal(null);
              } catch {
                // Keep the edited values available for correction.
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan Perubahan
          </Button>
        </div>
      </Modal>

      {/* Modal revisi harga */}
      <Modal busy={busy} open={!!revisiModal} onClose={() => setRevisiModal(null)} title="Revisi Harga Jasa">
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <Row label="Harga sekarang" strong>
              {rp(ticketJasa(ticket))}
            </Row>
          </div>
          <Field label="Harga jasa baru" required>
            <RpInput value={revisiJasa} onChange={setRevisiJasa} />
          </Field>
          <Field label="Alasan revisi" required hint="Contoh: setelah dibongkar ternyata IC power ikut rusak.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p className="text-xs text-accent-700">
            Sarankan konfirmasi ulang harga ke pelanggan via WA setelah revisi.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={!note.trim() || busy}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await run(() => reviseJasa(user, revisiModal ?? ticket, revisiJasa, note.trim()), {
                  pending: "Menyimpan revisi harga…",
                  success: "Revisi harga jasa tercatat",
                });
                setRevisiModal(null);
                setNote("");
              } catch {
                // The action hook displays the failure and preserves this form.
              } finally {
                setBusy(false);
              }
            }}
          >
            Simpan Revisi
          </Button>
        </div>
      </Modal>

      {/* Modal klaim garansi */}
      <Modal busy={busy} open={garansiModal} onClose={() => setGaransiModal(false)} title="Klaim Garansi">
        <div className="space-y-4">
          <div
            className={cn(
              "rounded-xl p-4 text-sm",
              garansiHariLewat <= GARANSI_SERVIS_HARI
                ? "bg-brand-50 text-brand-800"
                : "bg-accent-50 text-accent-800",
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
              if (busy) return;
              setBusy(true);
              try {
                const t = await run(() => createGaransiClaim(user, ticket, note.trim()), {
                  pending: "Membuat nota garansi…",
                  success: (claim) => `Nota garansi ${claim.noNota} dibuat`,
                  onUndo: () => nav(`/app/servis/${ticket.id}`),
                });
                setGaransiModal(false);
                setNote("");
                nav(`/app/servis/${t.id}`);
              } catch {
                // The action hook displays the failure and preserves this form.
              } finally {
                setBusy(false);
              }
            }}
          >
            Buat Nota Garansi
          </Button>
        </div>
      </Modal>

      {/* Modal bayar piutang */}
      <Modal busy={busy} open={!!piutangModal} onClose={() => setPiutangModal(null)} title="Pembayaran Piutang">
        <div className="space-y-4">
          <div className="rounded-xl bg-accent-50 p-4 text-sm">
            <Row label="Piutang saat ini" strong>
              <span className="text-accent-800">{rp(ticket.piutang ?? 0)}</span>
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
              if (busy) return;
              setBusy(true);
              try {
                await run(() => payPiutang(user, piutangModal ?? ticket, bayarPiutang, method), {
                  pending: "Mencatat pembayaran piutang…",
                  success: "Pembayaran piutang tercatat",
                });
                setPiutangModal(null);
              } catch {
                // The action hook displays the failure and preserves this form.
              } finally {
                setBusy(false);
              }
            }}
          >
            Catat Pembayaran
          </Button>
        </div>
      </Modal>
    </>
  );
}
