import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import { db } from "@/db/db";
import { ticketSisa, ticketTotal } from "@/db/tickets";
import { getSetting } from "@/db/settings";
import { rp, fmtDateTime, fmtDate } from "@/lib/format";
import { waLink } from "@/lib/wa";
import { Button } from "@/components/ui/button";
import { TICKET_STATUS_LABEL } from "@/components/ui/status-tag";

function useStore() {
  const [store, setStore] = useState({
    name: "",
    address: "",
    phone: "",
    footer: "",
  });
  useEffect(() => {
    (async () => {
      setStore({
        name: await getSetting("storeName"),
        address: await getSetting("storeAddress"),
        phone: await getSetting("storePhone"),
        footer: await getSetting("notaFooter"),
      });
    })();
  }, []);
  return store;
}

const Line = () => (
  <div className="my-1 border-t border-dashed border-slate-400" />
);

function NotaRow({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}
    >
      <span>{l}</span>
      <span className="text-right tabular-nums">{r}</span>
    </div>
  );
}

/** Nota 58mm untuk servis maupun penjualan unit; ?label=1 = label tempel unit. */
export function NotaPrintPage() {
  const { type, id } = useParams();
  const [params] = useSearchParams();
  const labelMode = params.get("label") === "1";
  const nav = useNavigate();
  const store = useStore();

  const ticket = useLiveQuery(
    () => (type === "servis" ? db.tickets.get(id!) : undefined),
    [type, id],
  );
  const unit = useLiveQuery(
    () => (type === "unit" ? db.units.get(id!) : undefined),
    [type, id],
  );

  const data = type === "servis" ? ticket : unit;
  if (!data) return null;

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
        <div className="nota-print mx-auto w-[58mm] rounded-lg bg-white p-3 font-mono text-[11px] leading-snug shadow">
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
  if (ticket) {
    waPhoneNum = ticket.phone;
    waText = [
      `*${store.name}* — Nota Servis`,
      `No: ${ticket.noNota}`,
      `Pelanggan: ${ticket.customerName}`,
      `Unit: ${ticket.brand} ${ticket.model}`,
      `Keluhan: ${ticket.keluhan}`,
      `Status: ${TICKET_STATUS_LABEL[ticket.status]}`,
      ...ticket.partsUsed.map(
        (p) => `${p.qty}× ${p.nama}: ${rp(p.harga * p.qty)}`,
      ),
      `Total: ${rp(ticketTotal(ticket))}`,
      ticket.dp > 0 ? `DP: ${rp(ticket.dp)}` : "",
      `Sisa: ${rp(ticketSisa(ticket))}`,
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

      <div className="nota-print mx-auto w-[58mm] rounded-lg bg-white p-3 font-mono text-[11px] leading-relaxed shadow">
        <div className="text-center">
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
            <NotaRow
              l={ticket.biayaJasa ? "Biaya jasa" : "Estimasi"}
              r={rp(ticket.biayaJasa || ticket.estimasi)}
            />
            {ticket.partsUsed.map((p, i) => (
              <NotaRow key={i} l={`${p.qty}x ${p.nama}`} r={rp(p.harga * p.qty)} />
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
