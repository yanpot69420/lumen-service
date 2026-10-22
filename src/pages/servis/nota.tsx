import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand";
import { useUser } from "@/auth/session";
import { TICKET_STATUS_LABEL } from "@/components/ui/status-tag";
import { db } from "@/db/db";
import { getSetting } from "@/db/settings";
import { isCloud } from "@/db/supabase";
import { refreshReceiptData } from "@/db/sync";
import { ticketJasa, ticketSisa, ticketTotal } from "@/db/tickets";
import { fmtDate, fmtDateTime, rp } from "@/lib/format";
import { waLink } from "@/lib/wa";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

function useStore() {
  return useLiveQuery(async () => ({
    name: await getSetting("storeName"),
    address: await getSetting("storeAddress"),
    phone: await getSetting("storePhone"),
    footer: await getSetting("notaFooter"),
  }), [], {
    name: "",
    address: "",
    phone: "",
    footer: "",
  });
}

const Line = () => (
  <div className="my-1 border-t border-dashed border-slate-400" />
);

function NotaRow({ l, r, bold }: { l: string; r: string; bold?: boolean; }) {
  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-2 ${bold ? "font-bold" : ""}`}
    >
      <span className="min-w-0">{l}</span>
      <span className="min-w-0 text-right tabular-nums">{r}</span>
    </div>
  );
}

/** Nota 58mm untuk servis maupun penjualan unit; ?label=1 = label tempel unit. */
export function NotaPrintPage() {
  const user = useUser();
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const labelMode = params.get("label") === "1";
  const nav = useNavigate();
  const store = useStore();
  const [attempt, setAttempt] = useState(0);
  const [remote, setRemote] = useState<{ key: string; error?: string; done: boolean }>({ key: "", done: false });

  const ticket = useLiveQuery(
    async () => (type === "servis" && id ? (await db.tickets.get(id)) ?? null : null),
    [type, id],
  );
  const unit = useLiveQuery(
    async () => (type === "unit" && id ? (await db.units.get(id)) ?? null : null),
    [type, id],
  );

  const data = type === "servis" ? ticket : unit;
  const validType = type === "servis" || type === "unit";
  const remoteKey = `${type}:${id}:${attempt}`;
  useEffect(() => {
    if (!isCloud || !validType || !id || data !== null) return;
    let cancelled = false;
    // Defer until the session layout effect and its generation are settled.
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      if (!navigator.onLine) throw new Error("Nota belum tersedia di perangkat ini. Sambungkan internet lalu coba lagi.");
      await refreshReceiptData(type as "servis" | "unit", user.id);
    }).then(() => { if (!cancelled) setRemote({ key: remoteKey, done: true }); })
      .catch((error: unknown) => { if (!cancelled) setRemote({ key: remoteKey, done: true, error: error instanceof Error ? error.message : "Nota belum dapat diambil dari cloud." }); });
    return () => { cancelled = true; };
  }, [remoteKey, data, validType, user.id, type, id]);
  const checkingRemote = isCloud && validType && data === null && (remote.key !== remoteKey || !remote.done);
  if (checkingRemote || data === undefined) return <div className="min-h-dvh bg-slate-100 p-6 text-center text-sm text-slate-500" role="status">Mengambil nota…</div>;
  if (!validType || data === null) return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
      <div className="max-w-sm rounded-2xl bg-white p-6 text-center">
        <h1 className="text-lg font-bold">{remote.error ? "Nota belum dapat dimuat" : "Nota tidak ditemukan"}</h1>
        <p className="mt-2 text-sm text-slate-500">{remote.error ?? "Periksa kembali tautan atau buka nota melalui daftar transaksi."}</p>
        {remote.error && <Button variant="outline" className="mt-4" onClick={() => setAttempt((value) => value + 1)}>Coba lagi</Button>}
        <Button className="mt-5" onClick={() => nav("/app/beranda")}><ArrowLeft /> Kembali ke beranda</Button>
      </div>
    </div>
  );

  // Label kecil untuk ditempel di unit — identitas cepat bagi teknisi.
  if (labelMode && ticket) {
    return (
      <div className="min-h-dvh bg-slate-100 py-6">
        <div className="no-print mx-auto mb-4 flex max-w-xs justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <ArrowLeft /> Kembali
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Cetak Label
          </Button>
        </div>
        <div className="nota-print mx-auto w-[58mm] max-w-full rounded-lg bg-white p-3 font-mono text-[11px] leading-snug shadow">
          <p className="text-center text-base font-black">{ticket.noNota}</p>
          <Line />
          <p className="font-bold">{ticket.customerName}</p>
          <p>
            {ticket.brand} {ticket.model}
          </p>
          <p className="truncate">{ticket.keluhan}</p>
          <p>{fmtDateTime(ticket.createdAt)}</p>
          {ticket.kelengkapan.length > 0 && (
            <p>[{ticket.kelengkapan.join(", ")}]</p>
          )}
        </div>
      </div>
    );
  }

  let waText = "";
  let waPhoneNum = "";
  const jasaTambahan = ticket ? ticketJasa(ticket) : 0;
  if (ticket) {
    waPhoneNum = ticket.phone;
    waText = [
      `*${store.name}* — Nota Servis`,
      `No: ${ticket.noNota}`,
      `Pelanggan: ${ticket.customerName}`,
      `Unit: ${ticket.brand} ${ticket.model}`,
      `Keluhan: ${ticket.keluhan}`,
      `Status: ${TICKET_STATUS_LABEL[ticket.status]}`,
      jasaTambahan > 0 ? `Biaya jasa tambahan: ${rp(jasaTambahan)}` : "",
      ...ticket.partsUsed.map(
        (p) => `${p.qty}× ${p.nama}: ${rp(p.harga * p.qty)}`,
      ),
      `Total: ${rp(ticketTotal(ticket))}`,
      ticket.dp > 0 ? `DP: ${rp(ticket.dp)}` : "",
      ticket.status === "diambil" && !ticketSisa(ticket) ? "LUNAS" : `Sisa: ${rp(ticketSisa(ticket))}`,
      store.footer,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (unit) {
    waPhoneNum = unit.buyerPhone ?? "";
    waText = [
      `*${store.name}* — Nota Penjualan`,
      `No: ${unit.kode}`,
      `Unit: ${unit.brand} ${unit.model} ${unit.varian}`.trim(),
      `IMEI: ${unit.imei}`,
      `Harga: ${rp(unit.soldPrice ?? unit.hargaJual)}`,
      unit.garansiHari > 0 ? `Garansi toko: ${unit.garansiHari} hari` : "",
      store.footer,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return (
    <div className="min-h-dvh bg-slate-100 py-6">
      <div className="no-print mx-auto mb-4 flex max-w-xs justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
          <ArrowLeft /> Kembali
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(waLink(waPhoneNum, waText), "_blank")}
          >
            <MessageCircle /> WA
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer /> Cetak
          </Button>
        </div>
      </div>

      <div className="nota-print mx-auto w-[58mm] max-w-full rounded-lg bg-white p-3 font-mono text-[11px] leading-relaxed shadow">
        <div className="text-center">
          <BrandMark className="mb-2 size-12 rounded-none" />
          <p className="text-sm font-bold uppercase">{store.name}</p>
          {store.address && <p>{store.address}</p>}
          {store.phone && <p>WA: {store.phone}</p>}
        </div>
        <Line />
        {ticket && (
          <>
            <NotaRow l="No" r={ticket.noNota} />
            <NotaRow l="Tgl" r={fmtDateTime(ticket.createdAt)} />
            <NotaRow l="Nama" r={ticket.customerName} />
            <NotaRow l="Unit" r={`${ticket.brand} ${ticket.model}`.trim()} />
            <Line />
            <p>Keluhan: {ticket.keluhan}</p>
            {ticket.kelengkapan.length > 0 && (
              <p>Kelengkapan: {ticket.kelengkapan.join(", ")}</p>
            )}
            <Line />
            {jasaTambahan > 0 && <NotaRow l="Biaya jasa tambahan" r={rp(jasaTambahan)} />}
            {ticket.partsUsed.map((p, i) => (
              <div key={i} className="my-1 min-w-0 break-inside-avoid">
                <p>{p.nama}</p>
                <NotaRow l={`${p.qty} pcs`} r={rp(p.harga * p.qty)} />
              </div>
            ))}
            <Line />
            <NotaRow l="TOTAL" r={rp(ticketTotal(ticket))} bold />
            {ticket.dp > 0 && <NotaRow l="DP" r={`-${rp(ticket.dp)}`} />}
            {ticket.status !== "diambil" && (
              <NotaRow l="SISA" r={rp(ticketSisa(ticket))} bold />
            )}
            {(ticket.piutang ?? 0) > 0 && (
              <NotaRow l="PIUTANG" r={rp(ticket.piutang!)} bold />
            )}
            <Line />
            <NotaRow l="Status" r={TICKET_STATUS_LABEL[ticket.status]} />
          </>
        )}
        {unit && (
          <>
            <NotaRow l="No" r={unit.kode} />
            <NotaRow l="Tgl" r={fmtDate(unit.soldAt ?? Date.now())} />
            {unit.buyerName && <NotaRow l="Pembeli" r={unit.buyerName} />}
            <Line />
            <p className="font-bold">
              {unit.brand} {unit.model} {unit.varian}
            </p>
            <NotaRow l="IMEI" r={unit.imei} />
            <NotaRow l="Kondisi" r={unit.kondisi || "-"} />
            <Line />
            <NotaRow l="HARGA" r={rp(unit.soldPrice ?? unit.hargaJual)} bold />
            {unit.garansiHari > 0 && (
              <NotaRow l="Garansi" r={`${unit.garansiHari} hari`} />
            )}
          </>
        )}
        <Line />
        <p className="text-center">{store.footer}</p>
      </div>
    </div>
  );
}
