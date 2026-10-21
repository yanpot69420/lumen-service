import { useUser } from "@/auth/session";
import { db } from "@/db/db";
import { correctPurchase, previewPurchaseCorrection, purchaseContext, type PurchaseContext, type PurchaseCorrectionInput } from "@/db/purchases";
import { methodOf } from "@/db/cash";
import type { CashEntry, Part } from "@/db/types";
import { fmtDateTime, rp } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { MethodPicker } from "./method-picker";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { Field, Input, RpInput, Select, Textarea } from "./ui/field";
import { Row } from "./ui/misc";
import { useToast } from "./ui/toast";
import { CashDescription } from "./cash-description";

export function PurchaseHistory({ part, onClose }: { part: Part; onClose: () => void; }) {
  const [entry, setEntry] = useState<CashEntry | null>(null);
  const currentPart = useLiveQuery(() => db.parts.get(part.id), [part.id]);
  const entries = useLiveQuery(() => db.cash.where("refId").equals(part.id).and((row) => row.refType === "part" && row.category === "restok_part" && row.type === "out").reverse().sortBy("at"), [part.id]);
  if (entry) return <PurchaseCorrection entry={entry} onClose={() => setEntry(null)} />;
  return <Modal open title="Riwayat Pembelian" onClose={onClose}>
    <p className="mb-4 break-words text-sm font-semibold">{currentPart?.nama ?? part.nama}</p>
    {entries === undefined ? <p role="status" className="text-sm text-slate-500">Memuat pembelian…</p> : !entries.length ? <p className="text-sm text-slate-500">Belum ada pembelian melalui kas untuk barang ini.</p> : <div className="space-y-3">{entries.map((row) => <div key={row.id} className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{fmtDateTime(row.at)} · {row.byName}</p>
      <div className="mt-2"><CashDescription entry={row} part={currentPart} /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><b className="text-sm tabular-nums">{rp(row.amount)}</b><Button size="sm" variant="outline" disabled={!!row.voided} onClick={() => setEntry(row)}>Koreksi Pembelian</Button></div>
      {row.meta?.purchase && <p className="mt-2 text-xs text-slate-500">{row.meta.purchase.qty} pcs · biaya bersih {rp(row.meta.purchase.totalCost)}</p>}
      {!!row.voided && <p className="mt-2 text-xs text-red-600">Transaksi dibatalkan</p>}
    </div>)}</div>}
  </Modal>;
}

export function PurchaseCorrection({ entry, onClose }: { entry: CashEntry; onClose: () => void; }) {
  const user = useUser();
  const toast = useToast();
  const [context, setContext] = useState<PurchaseContext | null>(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState<PurchaseCorrectionInput>({ qty: 1, totalCost: 0, kind: "record", method: methodOf(entry), reason: "" });
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentPart = useLiveQuery(() => entry.refType === "part" && entry.refId ? db.parts.get(entry.refId) : undefined, [entry.refType, entry.refId]);
  const submitting = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setContext(null); setError(""); setReview(false);
    void purchaseContext(entry.id).then((value) => {
      if (cancelled) return;
      setContext(value);
      setInput({ qty: value.snapshot.qty, totalCost: value.snapshot.totalCost, kind: "record", method: methodOf(value.entry), reason: "" });
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Pembelian belum dapat dimuat"); });
    return () => { cancelled = true; };
  }, [entry.id]);
  let preview: ReturnType<typeof previewPurchaseCorrection> | undefined;
  let validation = "";
  if (context) {
    try { preview = previewPurchaseCorrection(context, input); }
    catch (reason) { validation = reason instanceof Error ? reason.message : "Periksa data koreksi"; }
  }
  const changed = !!context && !!preview && (input.qty !== context.snapshot.qty || input.totalCost !== context.snapshot.totalCost || preview.unitCost !== context.part.hargaModal);
  async function save() {
    if (!context || !review || !changed || !input.reason.trim() || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await correctPurchase(user, context, input);
      toast("Koreksi pembelian diterapkan. Stok, modal, dan kas sudah diperbarui.");
      onClose();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Koreksi pembelian gagal", "error");
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal open title={review ? "Konfirmasi Koreksi Pembelian" : "Koreksi Pembelian"} onClose={onClose} busy={busy}>
    {error ? <div role="alert" className="space-y-4"><p className="text-sm text-accent-900">{error}</p><Button variant="outline" onClick={onClose}>Tutup</Button></div> : !context ? <p role="status" className="text-sm text-slate-500">Memeriksa pembelian dan stok…</p> : <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4"><CashDescription entry={context.entry} part={currentPart ?? context.part} /><p className="mt-1 text-xs text-slate-500">{fmtDateTime(context.entry.at)} · {context.entry.byName}</p></div>
      {!review && <>
        {context.legacy && <p className="rounded-xl bg-accent-50 p-3 text-xs leading-relaxed text-accent-900">Pembelian lama belum menyimpan rincian jumlah. Cocokkan jumlah seluruh barang dari pembelian ini dengan nota supplier. Nilai yang Anda isi akan menjadi jumlah stok akhirnya.</p>}
        <Field label="Jenis koreksi"><Select value={input.kind} onChange={(event) => setInput({ ...input, kind: event.target.value as PurchaseCorrectionInput["kind"], qty: context.snapshot.qty })}><option value="record">Salah pencatatan pembelian</option><option value="refund">Pengembalian uang supplier</option></Select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Jumlah pembelian benar" required><Input inputMode="numeric" value={input.qty || ""} disabled={input.kind === "refund"} onChange={(event) => setInput({ ...input, qty: Number(event.target.value.replace(/\D/g, "")) })} /></Field>
          <Field label="Total biaya yang benar" required hint="Total seluruh barang, bukan harga per pcs."><RpInput value={input.totalCost} onChange={(totalCost) => setInput({ ...input, totalCost })} /></Field>
        </div>
        {input.kind === "refund" && <Field label="Uang dikembalikan melalui"><MethodPicker value={input.method} onChange={(method) => setInput({ ...input, method })} /></Field>}
        <Field label="Alasan koreksi" required><Textarea value={input.reason} onChange={(event) => setInput({ ...input, reason: event.target.value })} placeholder="Contoh: salah ketik harga dari nota supplier" /></Field>
      </>}
      {validation && <p role="alert" className="text-sm text-red-600">{validation}</p>}
      {preview && <div className="rounded-2xl border border-slate-200 p-4">
        <Row label="Jumlah pembelian">{context.snapshot.qty} → <b>{input.qty} pcs</b></Row>
        <Row label="Total biaya bersih">{rp(context.snapshot.totalCost)} → <b>{rp(input.totalCost)}</b></Row>
        <Row label="Stok tersedia">{context.part.stok} → <b>{preview.stock}</b></Row>
        <Row label="Modal rata-rata /pcs">{rp(context.part.hargaModal)} → <b>{rp(preview.unitCost)}</b></Row>
        {input.kind === "refund" ? <Row label="Kas masuk dari supplier"><b>{rp(preview.refund)}</b></Row> : <Row label="Pengeluaran pembelian">{rp(context.entry.amount)} → <b>{rp(preview.cashAmount)}</b></Row>}
      </div>}
      {review && <><p className="text-sm leading-relaxed text-slate-600">Perubahan langsung diterapkan dan dicatat dalam jurnal koreksi. {input.kind === "refund" ? "Pembayaran awal tetap disimpan; pengembalian supplier dicatat sebagai kas masuk baru." : "Nominal transaksi asal diperbaiki bersama stok dan modal barang."}</p><p className="break-words text-sm"><b>Alasan:</b> {input.reason}</p></>}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={review ? () => setReview(false) : onClose}>{review ? "Kembali" : "Batal"}</Button><Button disabled={busy || !changed || !input.reason.trim() || !!validation} onClick={review ? () => { void save(); } : () => setReview(true)}>{busy ? "Menyimpan…" : review ? "Terapkan Koreksi" : "Periksa Perubahan"}</Button></div>
    </div>}
  </Modal>;
}
