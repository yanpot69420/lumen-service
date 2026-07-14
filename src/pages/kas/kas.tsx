import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowUpRight, Lock, Pencil, Plus, Wallet } from "lucide-react";
import { db, uid } from "@/db/db";
import type { CashCategory, CashEntry, CashMethod } from "@/db/types";
import { addCash, CASH_CATEGORY_LABEL, expectedCashToday, sumCash, methodOf } from "@/db/cash";
import { MethodPicker, MethodTag } from "@/components/method-picker";
import { logAudit } from "@/db/audit";
import { useUser } from "@/auth/session";
import { rp, dayKey, fmtTime, fmtDate } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Kpi, EmptyState, Row } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const MANUAL_IN: CashCategory[] = ["modal_masuk", "lainnya"];
const MANUAL_OUT: CashCategory[] = ["restok_part", "operasional", "prive", "lainnya"];

export function KasPage() {
  const user = useUser();
  const toast = useToast();
  const today = dayKey();
  const [day, setDay] = useState(today);
  const entries = useLiveQuery(
    () => db.cash.where("dayKey").equals(day).reverse().sortBy("at"),
    [day],
  );
  const close = useLiveQuery(() => db.dayCloses.get(day), [day]);
  // Dexie melacak tabel yang dibaca di dalam query — otomatis segar saat
  // ada koreksi nominal sekalipun jumlah entri tidak berubah.
  const expected = useLiveQuery(() => expectedCashToday(), []);

  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [korEntry, setKorEntry] = useState<CashEntry | null>(null);

  const { masuk, keluar } = sumCash(entries ?? []);
  const isToday = day === today;

  return (
    <>
      <PageHeader
        title="Kas"
        action={
          <Button variant="accent" size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Catat
          </Button>
        }
      />
      <PageBody>
        <Input
          type="date"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value || today)}
          className="w-full sm:w-48"
        />
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="Masuk" value={rp(masuk)} tone="positive" />
          <Kpi label="Keluar" value={rp(keluar)} tone="negative" />
          <Kpi
            label={isToday ? "Tunai di laci (perkiraan)" : "Net hari ini"}
            value={rp(isToday ? (expected ?? 0) : masuk - keluar)}
            sub={isToday ? "QRIS/transfer tidak dihitung" : undefined}
          />
        </div>

        {close ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-semibold text-emerald-800">
              <Lock className="size-4" /> Kas {fmtDate(close.closedAt)} sudah ditutup
            </div>
            <Row label="Seharusnya">{rp(close.expected)}</Row>
            <Row label="Uang fisik dihitung">{rp(close.counted)}</Row>
            <Row label="Selisih" strong>
              <span className={close.selisih === 0 ? "text-emerald-600" : "text-red-600"}>
                {close.selisih >= 0 ? "+" : ""}
                {rp(close.selisih)}
              </span>
            </Row>
            <p className="mt-1 text-xs text-emerald-700">
              Ditutup oleh {close.closedByName}
              {close.note && ` — ${close.note}`}
            </p>
          </div>
        ) : (
          isToday && (
            <Button variant="outline" size="lg" className="w-full" onClick={() => setCloseOpen(true)}>
              <Lock /> Tutup Kas Hari Ini
            </Button>
          )
        )}

        {entries?.length === 0 && (
          <EmptyState
            icon={<Wallet />}
            title="Belum ada transaksi di tanggal ini"
            hint="Transaksi servis & jual-beli tercatat otomatis di sini."
          />
        )}
        <div className="space-y-2">
          {entries?.map((e) => (
            <div
              key={e.id}
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5",
                e.voided === 1 && "opacity-50",
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  e.type === "in"
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-red-100 text-red-600",
                )}
              >
                {e.type === "in" ? (
                  <ArrowDownLeft className="size-4" />
                ) : (
                  <ArrowUpRight className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-medium", e.voided === 1 && "line-through")}>
                  {e.note || CASH_CATEGORY_LABEL[e.category]}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  {fmtTime(e.at)} · {CASH_CATEGORY_LABEL[e.category]} · {e.byName}
                  <MethodTag method={methodOf(e)} />
                  {e.voided === 1 && " · DIBATALKAN"}
                </p>
              </div>
              <p
                className={cn(
                  "text-sm font-bold tabular-nums",
                  e.type === "in" ? "text-emerald-600" : "text-red-600",
                  e.voided === 1 && "line-through",
                )}
              >
                {e.type === "in" ? "+" : "−"}
                {rp(e.amount)}
              </p>
              {e.locked === 1 ? (
                <Lock className="size-3.5 shrink-0 text-slate-300" />
              ) : (
                <button
                  onClick={() => setKorEntry(e)}
                  className="shrink-0 text-slate-300 hover:text-brand-500"
                  aria-label="Ajukan koreksi"
                >
                  <Pencil className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-slate-400">
          Transaksi tidak bisa dihapus — koreksi lewat tombol ✎ dan tercatat di jurnal.
        </p>
      </PageBody>

      <AddCashSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <TutupKasSheet
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        expected={expected ?? 0}
      />
      <KoreksiSheet entry={korEntry} onClose={() => setKorEntry(null)} />
    </>
  );
}

function AddCashSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useUser();
  const toast = useToast();
  const [type, setType] = useState<"in" | "out">("out");
  const [category, setCategory] = useState<CashCategory>("operasional");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<CashMethod>("tunai");
  const [busy, setBusy] = useState(false);
  const cats = type === "in" ? MANUAL_IN : MANUAL_OUT;

  return (
    <Sheet open={open} onClose={onClose} title="Catat Kas Manual">
      <div className="space-y-4">
        <div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1 text-sm font-medium">
          {(
            [
              ["out", "Uang Keluar"],
              ["in", "Uang Masuk"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setType(k);
                setCategory(k === "in" ? "modal_masuk" : "operasional");
              }}
              className={cn(
                "rounded-lg py-2",
                type === k ? "bg-white shadow-sm" : "text-slate-500",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Kategori">
          <Select value={category} onChange={(e) => setCategory(e.target.value as CashCategory)}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {CASH_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nominal" required>
          <RpInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Metode">
          <MethodPicker value={method} onChange={setMethod} />
        </Field>
        <Field label="Keterangan" required>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Bayar listrik, beli alat, prive owner…"
          />
        </Field>
        <Button
          size="lg"
          className="w-full"
          disabled={amount <= 0 || !note.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await addCash(user, {
                type,
                category,
                amount,
                method,
                note: note.trim(),
              });
              await logAudit(
                user, "kas", "kas", id,
                `${type === "in" ? "Masuk" : "Keluar"} ${rp(amount)} (${CASH_CATEGORY_LABEL[category]}): ${note.trim()}`,
              );
              toast("Tercatat");
              setAmount(0);
              setNote("");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Simpan
        </Button>
      </div>
    </Sheet>
  );
}

function TutupKasSheet({
  open,
  onClose,
  expected,
}: {
  open: boolean;
  onClose: () => void;
  expected: number;
}) {
  const user = useUser();
  const toast = useToast();
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const selisih = counted - expected;

  return (
    <Sheet open={open} onClose={onClose} title="Tutup Kas Hari Ini">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <Row label="Tunai seharusnya (sistem)" strong>
            {rp(expected)}
          </Row>
          <p className="mt-1 text-xs text-slate-400">
            Hanya pembayaran tunai — QRIS/transfer tidak masuk laci.
          </p>
        </div>
        <Field label="Uang fisik di laci (hasil hitung)" required>
          <RpInput value={counted} onChange={setCounted} />
        </Field>
        <div
          className={cn(
            "rounded-xl p-4 text-sm font-semibold",
            selisih === 0
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700",
          )}
        >
          Selisih: {selisih >= 0 ? "+" : ""}
          {rp(selisih)}
          {selisih === 0 && " — pas ✔"}
        </div>
        {selisih !== 0 && (
          <Field label="Penjelasan selisih" required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        <Button
          size="lg"
          className="w-full"
          disabled={busy || (selisih !== 0 && !note.trim())}
          onClick={async () => {
            setBusy(true);
            try {
              const dk = dayKey();
              await db.dayCloses.put({
                dayKey: dk,
                expected,
                counted,
                selisih,
                note: note.trim(),
                closedBy: user.id,
                closedByName: user.name,
                closedAt: Date.now(),
              });
              await db.cash.where("dayKey").equals(dk).modify({ locked: 1 });
              await logAudit(
                user, "tutup-kas", "kas", dk,
                `Tutup kas ${dk}: sistem ${rp(expected)}, fisik ${rp(counted)}, selisih ${rp(selisih)}`,
              );
              toast("Kas hari ini ditutup");
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          Tutup Kas
        </Button>
        <p className="text-xs text-slate-400">
          Setelah ditutup, transaksi hari ini terkunci dan hanya bisa diubah lewat jurnal koreksi.
        </p>
      </div>
    </Sheet>
  );
}

function KoreksiSheet({
  entry,
  onClose,
}: {
  entry: CashEntry | null;
  onClose: () => void;
}) {
  const user = useUser();
  const toast = useToast();
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [voidIt, setVoidIt] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset form tiap ganti entry
  const [lastId, setLastId] = useState<string | null>(null);
  if (entry && entry.id !== lastId) {
    setLastId(entry.id);
    setAmount(entry.amount);
    setNote(entry.note);
    setReason("");
    setVoidIt(false);
  }

  if (!entry) return null;
  const isOwner = user.role === "owner";

  return (
    <Sheet open={!!entry} onClose={onClose} title="Ajukan Koreksi">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <Row label="Transaksi">{entry.note || CASH_CATEGORY_LABEL[entry.category]}</Row>
          <Row label="Nominal sekarang" strong>{rp(entry.amount)}</Row>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={voidIt}
            onChange={(e) => setVoidIt(e.target.checked)}
            className="size-4 rounded"
          />
          Batalkan transaksi ini (void)
        </label>
        {!voidIt && (
          <>
            <Field label="Nominal seharusnya">
              <RpInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Keterangan baru">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Alasan koreksi" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Salah ketik nominal / transaksi dobel…"
          />
        </Field>
        <Button
          size="lg"
          className="w-full"
          disabled={!reason.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const pendingSame = await db.corrections
                .where("status")
                .equals("pending")
                .and((k) => k.entityId === entry.id)
                .count();
              if (pendingSame > 0) {
                toast("Transaksi ini sudah punya koreksi yang menunggu persetujuan", "error");
                return;
              }
              const after = voidIt
                ? { amount: entry.amount, note: entry.note, voided: 1 as const }
                : { amount, note: note.trim(), voided: 0 as const };
              const kor = {
                id: uid(),
                at: Date.now(),
                entity: "cash" as const,
                entityId: entry.id,
                reason: reason.trim(),
                before: { amount: entry.amount, note: entry.note, voided: entry.voided },
                after,
                requestedBy: user.id,
                requestedByName: user.name,
                status: isOwner ? ("approved" as const) : ("pending" as const),
                ...(isOwner && {
                  decidedBy: user.id,
                  decidedByName: user.name,
                  decidedAt: Date.now(),
                }),
              };
              await db.corrections.add(kor);
              if (isOwner) {
                await db.cash.update(entry.id, after);
              }
              await logAudit(
                user, "koreksi", "kas", entry.id,
                `${isOwner ? "Koreksi langsung" : "Ajukan koreksi"}: ${reason.trim()}`,
              );
              toast(
                isOwner
                  ? "Koreksi diterapkan & tercatat"
                  : "Koreksi diajukan — menunggu persetujuan Owner",
              );
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {isOwner ? "Terapkan Koreksi" : "Ajukan ke Owner"}
        </Button>
      </div>
    </Sheet>
  );
}
