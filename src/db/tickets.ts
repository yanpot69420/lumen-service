import { db, uid } from "./db";
import { addCash } from "./cash";
import { logAudit } from "./audit";
import { nextNota } from "./settings";
import { ticketSisa, ticketTotal } from "./money";
import type { CashMethod, PartUsed, Ticket, TicketStatus, User } from "./types";

export { ticketTotal, ticketSisa } from "./money";

/** Masa garansi servis (hari) sejak unit diambil. */
export const GARANSI_SERVIS_HARI = 7;

export function diambilAt(t: Ticket): number | undefined {
  for (let i = t.history.length - 1; i >= 0; i--) {
    if (t.history[i].status === "diambil") return t.history[i].at;
  }
  return undefined;
}

export async function createTicket(
  user: User,
  data: Pick<
    Ticket,
    | "customerName"
    | "phone"
    | "brand"
    | "model"
    | "keluhan"
    | "kelengkapan"
    | "estimasi"
    | "dp"
  >,
  photos: Blob[],
  dpMethod: CashMethod = "tunai",
  garansiDari?: string,
): Promise<Ticket> {
  const noNota = await nextNota("ticket");
  const now = Date.now();
  const ticket: Ticket = {
    ...data,
    id: uid(),
    noNota,
    garansiDari,
    biayaJasa: 0,
    status: "masuk",
    history: [
      {
        status: "masuk",
        at: now,
        by: user.name,
        note: garansiDari ? "Klaim garansi" : undefined,
      },
    ],
    partsUsed: [],
    createdAt: now,
    updatedAt: now,
    createdBy: user.id,
  };
  await db.tickets.add(ticket);
  for (const blob of photos) {
    await db.photos.add({
      id: uid(),
      refType: "ticket",
      refId: ticket.id,
      blob,
      createdAt: now,
    });
  }
  if (data.dp > 0) {
    await addCash(user, {
      type: "in",
      category: "servis",
      amount: data.dp,
      method: dpMethod,
      note: `DP servis ${noNota} — ${data.customerName}`,
      refType: "ticket",
      refId: ticket.id,
    });
  }
  await logAudit(
    user,
    "buat",
    "servis",
    ticket.id,
    `Nota ${noNota}: ${data.brand} ${data.model} (${data.customerName})${garansiDari ? " [klaim garansi]" : ""}`,
  );
  return ticket;
}

/** Buat tiket klaim garansi yang tertaut ke tiket asal. */
export async function createGaransiClaim(
  user: User,
  source: Ticket,
  keluhan: string,
): Promise<Ticket> {
  const t = await createTicket(
    user,
    {
      customerName: source.customerName,
      phone: source.phone,
      brand: source.brand,
      model: source.model,
      keluhan,
      kelengkapan: [],
      estimasi: 0,
      dp: 0,
    },
    [],
    "tunai",
    source.id,
  );
  await logAudit(
    user,
    "garansi",
    "servis",
    source.id,
    `${source.noNota}: klaim garansi → ${t.noNota}`,
  );
  return t;
}

/** Transisi status + efek samping keuangan. */
export async function changeStatus(
  user: User,
  ticket: Ticket,
  status: TicketStatus,
  opts: {
    note?: string;
    biayaJasa?: number;
    bayar?: number;
    method?: CashMethod;
    refundDp?: boolean;
  } = {},
) {
  const now = Date.now();
  const patch: Partial<Ticket> = {
    status,
    updatedAt: now,
    history: [
      ...ticket.history,
      { status, at: now, by: user.name, note: opts.note },
    ],
  };
  if (opts.biayaJasa !== undefined) patch.biayaJasa = opts.biayaJasa;

  if (status === "diambil") {
    const sisa = ticketSisa({ ...ticket, ...patch } as Ticket);
    const bayar = Math.min(opts.bayar ?? sisa, sisa);
    const piutang = sisa - bayar;
    if (piutang > 0) {
      patch.piutang = piutang;
      patch.history = [
        ...patch.history!,
        {
          status: "diambil" as const,
          at: now,
          by: user.name,
          note: `Piutang tercatat: sisa belum dibayar`,
        },
      ];
    }
    if (bayar > 0) {
      await addCash(user, {
        type: "in",
        category: "servis",
        amount: bayar,
        method: opts.method ?? "tunai",
        note: `Pelunasan servis ${ticket.noNota} — ${ticket.customerName}`,
        refType: "ticket",
        refId: ticket.id,
      });
    }
  }

  if (status === "batal" && ticket.dp > 0) {
    if (opts.refundDp) {
      await addCash(user, {
        type: "out",
        category: "servis",
        amount: ticket.dp,
        method: opts.method ?? "tunai",
        note: `Refund DP ${ticket.noNota} — ${ticket.customerName}`,
        refType: "ticket",
        refId: ticket.id,
      });
    } else {
      patch.history = [
        ...patch.history!,
        {
          status: "batal" as const,
          at: now,
          by: user.name,
          note: "DP tidak dikembalikan (biaya pengecekan)",
        },
      ];
    }
  }

  await db.tickets.update(ticket.id, patch);
  await logAudit(
    user,
    "status",
    "servis",
    ticket.id,
    `${ticket.noNota} → ${status}${opts.note ? ` (${opts.note})` : ""}`,
  );
}

/** Terima pembayaran piutang setelah unit diambil. */
export async function payPiutang(
  user: User,
  ticket: Ticket,
  amount: number,
  method: CashMethod,
) {
  const piutang = ticket.piutang ?? 0;
  const bayar = Math.min(amount, piutang);
  if (bayar <= 0) return;
  await addCash(user, {
    type: "in",
    category: "servis",
    amount: bayar,
    method,
    note: `Pembayaran piutang ${ticket.noNota} — ${ticket.customerName}`,
    refType: "ticket",
    refId: ticket.id,
  });
  await db.tickets.update(ticket.id, {
    piutang: piutang - bayar,
    updatedAt: Date.now(),
  });
  await logAudit(
    user,
    "piutang",
    "servis",
    ticket.id,
    `${ticket.noNota}: piutang dibayar (sisa berkurang)`,
  );
}

/** Revisi biaya jasa setelah konfirmasi — wajib beralasan, tercatat di riwayat. */
export async function reviseJasa(
  user: User,
  ticket: Ticket,
  newJasa: number,
  reason: string,
) {
  const old = ticket.biayaJasa || ticket.estimasi;
  await db.tickets.update(ticket.id, {
    biayaJasa: newJasa,
    updatedAt: Date.now(),
    history: [
      ...ticket.history,
      {
        status: ticket.status,
        at: Date.now(),
        by: user.name,
        note: `Revisi harga jasa: ${old} → ${newJasa}. Alasan: ${reason}`,
      },
    ],
  });
  await logAudit(
    user,
    "revisi-harga",
    "servis",
    ticket.id,
    `${ticket.noNota}: jasa ${old} → ${newJasa} (${reason})`,
  );
}

/** Perbaiki data non-finansial (nama/HP/unit/keluhan) — tercatat di audit. */
export async function updateTicketInfo(
  user: User,
  ticket: Ticket,
  patch: Pick<
    Ticket,
    "customerName" | "phone" | "brand" | "model" | "keluhan" | "kelengkapan"
  >,
) {
  const changes: string[] = [];
  if (patch.customerName !== ticket.customerName)
    changes.push(`nama "${ticket.customerName}"→"${patch.customerName}"`);
  if (patch.phone !== ticket.phone)
    changes.push(`hp "${ticket.phone}"→"${patch.phone}"`);
  if (patch.brand !== ticket.brand || patch.model !== ticket.model)
    changes.push(`unit → ${patch.brand} ${patch.model}`);
  if (patch.keluhan !== ticket.keluhan) changes.push("keluhan diubah");
  if (patch.kelengkapan.join() !== ticket.kelengkapan.join())
    changes.push("kelengkapan diubah");
  if (changes.length === 0) return;
  await db.tickets.update(ticket.id, { ...patch, updatedAt: Date.now() });
  await logAudit(
    user,
    "edit-info",
    "servis",
    ticket.id,
    `${ticket.noNota}: ${changes.join("; ")}`,
  );
}

/** Pakai sparepart dari stok ke tiket (stok berkurang otomatis). */
export async function usePart(
  user: User,
  ticket: Ticket,
  partId: string,
  qty: number,
) {
  await db.transaction("rw", [db.parts, db.tickets, db.audit], async () => {
    const part = await db.parts.get(partId);
    if (!part) throw new Error("Sparepart tidak ditemukan");
    if (part.stok < qty) throw new Error(`Stok ${part.nama} tinggal ${part.stok}`);
    await db.parts.update(partId, { stok: part.stok - qty });
    const used: PartUsed = {
      partId,
      nama: part.nama,
      qty,
      harga: part.hargaJual,
      modal: part.hargaModal,
    };
    await db.tickets.update(ticket.id, {
      partsUsed: [...ticket.partsUsed, used],
      updatedAt: Date.now(),
    });
    await logAudit(
      user,
      "part",
      "servis",
      ticket.id,
      `${ticket.noNota}: pakai ${qty}× ${part.nama}`,
    );
  });
}

export async function removePart(user: User, ticket: Ticket, index: number) {
  const used = ticket.partsUsed[index];
  if (!used) return;
  await db.transaction("rw", [db.parts, db.tickets, db.audit], async () => {
    const part = await db.parts.get(used.partId);
    if (part) await db.parts.update(part.id, { stok: part.stok + used.qty });
    await db.tickets.update(ticket.id, {
      partsUsed: ticket.partsUsed.filter((_, i) => i !== index),
      updatedAt: Date.now(),
    });
    await logAudit(
      user,
      "part",
      "servis",
      ticket.id,
      `${ticket.noNota}: batal pakai ${used.qty}× ${used.nama}`,
    );
  });
}

/** Aksi status berikutnya yang masuk akal per status sekarang. */
export const NEXT_ACTIONS: Record<
  TicketStatus,
  { to: TicketStatus; label: string }[]
> = {
  masuk: [{ to: "dicek", label: "Mulai Pengecekan" }],
  dicek: [{ to: "konfirmasi", label: "Ajukan Harga ke Pelanggan" }],
  konfirmasi: [{ to: "dikerjakan", label: "Disetujui, Kerjakan" }],
  dikerjakan: [{ to: "selesai", label: "Tandai Selesai" }],
  selesai: [{ to: "diambil", label: "Diambil & Bayar" }],
  diambil: [],
  batal: [],
};
