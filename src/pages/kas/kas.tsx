import { canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { MethodPicker, MethodTag } from "@/components/method-picker";
import { Button } from "@/components/ui/button";
import { Field, Input, RpInput, Select, Textarea } from "@/components/ui/field";
import { EmptyState, Row } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CASH_CATEGORY_LABEL, closeCash, expectedCashToday, methodOf, recordManualCash, requestCorrection, sumCash } from "@/db/cash";
import { db } from "@/db/db";
import type { CashCategory, CashEntry, CashMethod } from "@/db/types";
import { cn } from "@/lib/cn";
import { dayKey, fmtDate, fmtTime, rp } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowUpRight, Lock, Pencil, Plus, Wallet } from "lucide-react";
import { useState } from "react";

const MANUAL_IN: CashCategory[] = ["modal_masuk", "lainnya"];
const MANUAL_OUT: CashCategory[] = ["operasional", "prive", "lainnya"];

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

  if (!canSeeMoney(user.role)) return <PageBody>Halaman Kas khusus Owner / Head Operasional.</PageBody>;
  const { masuk, keluar } = sumCash(entries ?? []);
  const isToday = day === today;

  return (
    <>
      <PageHeader
        title="Kas"
        subtitle="Pantau arus uang dan rekonsiliasi kas harian."
        action={
          <Button variant="accent" size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Catat<span className="hidden lg:inline">transaksi</span>
          </Button>
        }
      />
      <PageBody>
        <div className="lg:flex lg:items-center lg:justify-between lg:gap-4">
        <div className="hidden lg:block"><h2 className="text-lg font-semibold text-brand-950">Ringkasan harian</h2><p className="mt-1 text-sm text-slate-500">{isToday ? "Aktivitas hari ini" : fmtDate(new Date(`${day}T12:00:00+08:00`).getTime())} · {entries?.length ?? 0} transaksi tercatat</p></div>
        <Input
          type="date"
          aria-label="Tanggal pencatatan kas"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value || today)}
          className="w-full lg:h-11 lg:w-48 lg:rounded-xl lg:bg-white"
        />
        </div>
        <section className="space-y-3 lg:hidden" aria-label="Ringkasan kas">
          <div className="rounded-[26px] bg-brand-950 p-5 text-white">
            <div className="flex items-center gap-2 text-xs text-white/60"><Wallet className="size-4 text-accent-400" /> {isToday ? "Tunai di laci" : "Arus kas bersih"}</div>
            <p className="mt-3 break-words text-[30px] font-semibold leading-tight tracking-[-0.04em] tabular-nums">{rp(isToday ? (expected ?? 0) : masuk - keluar)}</p>
            <p className="mt-2 text-xs leading-relaxed text-white/50">{isToday ? "Perkiraan uang tunai. QRIS dan transfer terpisah." : `Pemasukan dikurangi pengeluaran pada ${fmtDate(new Date(`${day}T12:00:00+08:00`).getTime())}.`}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[22px] border border-slate-200 bg-white p-4"><p className="flex items-center gap-2 text-xs text-slate-500"><ArrowDownLeft className="size-4 text-brand-600" /> Masuk</p><p className="mt-2 break-words text-lg font-bold tracking-tight text-brand-700 tabular-nums">{rp(masuk)}</p></div>
            <div className="rounded-[22px] border border-slate-200 bg-white p-4"><p className="flex items-center gap-2 text-xs text-slate-500"><ArrowUpRight className="size-4 text-slate-500" /> Keluar</p><p className="mt-2 break-words text-lg font-bold tracking-tight text-slate-700 tabular-nums">{rp(keluar)}</p></div>
          </div>
        </section>
        <section className="hidden grid-cols-3 gap-4 lg:grid" aria-label="Ringkasan kas desktop">
          <div className="rounded-[22px] bg-brand-950 p-6 text-white"><p className="flex items-center gap-2 text-sm text-white/65"><Wallet className="size-4 text-accent-400" />{isToday ? "Tunai di laci" : "Arus kas bersih"}</p><p className="mt-3 break-words text-3xl font-semibold tracking-tight tabular-nums">{rp(isToday ? (expected ?? 0) : masuk - keluar)}</p><p className="mt-2 text-xs leading-relaxed text-white/50">{isToday ? "Perkiraan tunai, di luar QRIS dan transfer." : "Pemasukan dikurangi pengeluaran tanggal ini."}</p></div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-6"><p className="flex items-center gap-2 text-sm text-slate-500"><ArrowDownLeft className="size-4 text-brand-600" /> Uang masuk</p><p className="mt-3 break-words text-3xl font-semibold tracking-tight text-brand-700 tabular-nums">{rp(masuk)}</p><p className="mt-2 text-xs text-slate-400">Seluruh metode pembayaran</p></div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-6"><p className="flex items-center gap-2 text-sm text-slate-500"><ArrowUpRight className="size-4 text-slate-500" /> Uang keluar</p><p className="mt-3 break-words text-3xl font-semibold tracking-tight text-slate-700 tabular-nums">{rp(keluar)}</p><p className="mt-2 text-xs text-slate-400">Seluruh metode pembayaran</p></div>
        </section>

        {close ? (
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-x-8 lg:rounded-[22px] lg:px-6 lg:py-5">
            <div className="lg:row-span-3">
            <div className="mb-1 flex items-center gap-2 font-semibold text-brand-800">
              <Lock className="size-4" /> Kas {fmtDate(close.closedAt)} sudah ditutup
            </div>
            <p className="mt-1 hidden text-xs leading-relaxed text-brand-700 lg:block">Ditutup oleh {close.closedByName}{close.note && ` — ${close.note}`}</p>
            </div>
            <Row label="Seharusnya">{rp(close.expected)}</Row>
            <Row label="Uang fisik dihitung">{rp(close.counted)}</Row>
            <Row label="Selisih" strong>
              <span className={close.selisih === 0 ? "text-brand-600" : "text-red-600"}>
                {close.selisih >= 0 ? "+" : ""}
                {rp(close.selisih)}
              </span>
            </Row>
            <p className="mt-1 text-xs text-brand-700 lg:hidden">
              Ditutup oleh {close.closedByName}
              {close.note && ` — ${close.note}`}
            </p>
          </div>
        ) : (
          isToday && (
            <div className="lg:flex lg:items-center lg:justify-between lg:gap-6 lg:rounded-[22px] lg:border lg:border-slate-200 lg:bg-white lg:px-6 lg:py-5"><div className="hidden lg:block"><h3 className="text-sm font-semibold text-brand-950">Kas hari ini masih terbuka</h3><p className="mt-1 text-xs text-slate-500">Cocokkan uang fisik di laci, lalu tutup kas setelah operasional selesai.</p></div><Button variant="outline" size="lg" className="w-full lg:h-11 lg:w-auto lg:shrink-0 lg:rounded-xl" onClick={() => setCloseOpen(true)}>
              <Lock /> Tutup Kas Hari Ini
            </Button></div>
          )
        )}

        {entries?.length === 0 && (
          <EmptyState
            icon={<Wallet />}
            title="Belum ada transaksi di tanggal ini"
            hint="Transaksi servis & jual-beli tercatat otomatis di sini."
          />
        )}
        <div className="flex items-end justify-between px-1 lg:hidden"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Catatan harian</p><h2 className="mt-1 text-base font-bold tracking-tight">Aktivitas kas</h2></div><span className="text-xs text-slate-500">{entries?.length ?? 0} transaksi</span></div>
        <div className="space-y-3 lg:space-y-0 lg:overflow-hidden lg:rounded-[22px] lg:border lg:border-slate-200 lg:bg-white">
          <div className="hidden items-center justify-between border-b border-slate-100 px-6 py-5 lg:flex"><div><h2 className="text-base font-semibold text-brand-950">Jurnal transaksi</h2><p className="mt-1 text-xs text-slate-500">Pencatatan otomatis dan manual pada tanggal yang dipilih.</p></div><span className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">{entries?.length ?? 0} transaksi</span></div>
          <div aria-hidden className="hidden grid-cols-[40px_minmax(0,1fr)_100px_140px_36px] gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid"><span className="col-span-2">Transaksi</span><span>Metode</span><span className="text-right">Nominal</span><span /></div>
          {entries?.map((e) => (
            <div
              key={e.id}
              className={cn(
                "flex items-start gap-3 rounded-[22px] border border-slate-200 bg-white p-4 lg:grid lg:grid-cols-[40px_minmax(0,1fr)_100px_140px_36px] lg:items-center lg:gap-4 lg:rounded-none lg:border-0 lg:border-b lg:border-slate-100 lg:px-6 lg:py-5 lg:last:border-b-0",
                e.voided === 1 && "opacity-50",
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  e.type === "in"
                    ? "bg-brand-100 text-brand-600"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {e.type === "in" ? (
                  <ArrowDownLeft className="size-4" />
                ) : (
                  <ArrowUpRight className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("line-clamp-2 text-sm font-semibold leading-relaxed", e.voided === 1 && "line-through")}>
                  {e.note || CASH_CATEGORY_LABEL[e.category]}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-slate-400 lg:text-xs">
                  {fmtTime(e.at)} · {CASH_CATEGORY_LABEL[e.category]} · {e.byName}
                  <span className="lg:hidden"><MethodTag method={methodOf(e)} /></span>
                  {e.voided === 1 && " · DIBATALKAN"}
                </p>
                <p className={cn("mt-3 text-base font-bold tabular-nums lg:hidden", e.type === "in" ? "text-brand-700" : "text-slate-600", e.voided === 1 && "line-through")}>{e.type === "in" ? "+" : "−"}{rp(e.amount)}</p>
              </div>
              <div className="hidden lg:block"><MethodTag method={methodOf(e)} /></div>
              <p
                className={cn(
                  "hidden text-right text-sm font-semibold tabular-nums lg:block",
                  e.type === "in" ? "text-brand-600" : "text-slate-600",
                  e.voided === 1 && "line-through",
                )}
              >
                {e.type === "in" ? "+" : "−"}
                {rp(e.amount)}
              </p>
              {e.locked === 1 ? (
                <Lock className="size-3.5 shrink-0 text-slate-300 lg:justify-self-center" />
              ) : (
                <button
                  onClick={() => setKorEntry(e)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-brand-50 hover:text-brand-600 lg:size-9 lg:rounded-lg"
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

function AddCashSheet({ open, onClose }: { open: boolean; onClose: () => void; }) {
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
              await recordManualCash(user, { type, category, amount, method, note: note.trim() });
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
              ? "bg-brand-50 text-brand-700"
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
              await closeCash(user, counted, note.trim(), expected);
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
  if (!entry && lastId !== null) setLastId(null);
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
              await requestCorrection(user, entry.id, { amount: voidIt ? entry.amount : amount, note: note.trim(), voided: voidIt ? 1 : 0 }, reason.trim(), entry);
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
