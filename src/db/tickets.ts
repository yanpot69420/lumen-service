import { can } from "@/auth/roles";
import { logAudit } from "./audit";
import { addCash } from "./cash";
import { db, uid } from "./db";
import { resolveTicketCustomer } from "./customers";
import { ticketJasa, ticketTotal } from "./money";
import { amount, operation } from "./operations";
import { nextNota } from "./settings";
import type { CashMethod, PartUsed, Ticket, TicketStatus, User } from "./types";

export { ticketJasa, ticketSisa, ticketTotal } from "./money";

/** Masa garansi servis (hari) sejak unit diambil. */
export const GARANSI_SERVIS_HARI = 7;

export function diambilAt(t: Ticket): number | undefined {
  for (let i = t.history.length - 1; i >= 0; i--) {
    if (t.history[i].status === "diambil") return t.history[i].at;
  }
  return undefined;
}

// Compare the bill the operator actually reviewed, excluding sync metadata.
// A newer price/part edit must not silently become an unexpected receivable.
function billingSnapshot(ticket: Ticket) {
  return JSON.stringify([ticket.estimasi, ticket.biayaJasa, ticket.hargaFinal ?? ticket.biayaJasa > 0, ticket.dp, ticket.partsUsed.map((part) => [part.id, part.partId, part.nama, part.qty, part.harga, part.modal])]);
}

function infoSnapshot(ticket: Pick<Ticket, "customerName" | "phone" | "brand" | "model" | "keluhan" | "kelengkapan">) {
  return JSON.stringify([ticket.customerName, ticket.phone, ticket.brand, ticket.model, ticket.keluhan, ticket.kelengkapan]);
}

async function warrantySource(id: string): Promise<Ticket> {
  const source = await db.tickets.get(id);
  if (!source) throw new Error("Nota asal garansi tidak ditemukan");
  if (source.garansiDari) throw new Error("Klaim garansi harus tertaut ke nota servis asal");
  if (source.status !== "diambil") throw new Error("Klaim garansi hanya untuk nota yang sudah diambil");
  return source;
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
  > & { customerId?: string },
  photos: Blob[],
  dpMethod: CashMethod = "tunai",
  garansiDari?: string,
  draftRefId?: string,
  requestId = uid(),
): Promise<Ticket> {
  return operation(user, "service", async (user) => {
    const existing = await db.tickets.get(requestId);
    if (existing) return existing;
    amount(data.estimasi); amount(data.dp);
    if (data.dp > 0 && !can(user.role, "sell")) throw new Error("Penerimaan DP hanya untuk Kasir/Owner/Head Ops");
    if (!data.customerName.trim() || !data.brand.trim() || !data.keluhan.trim()) throw new Error("Data servis belum lengkap");
    if (garansiDari) await warrantySource(garansiDari);
    if (!garansiDari && !photos.length && (!draftRefId || !await db.photos.where({ refType: "draft", refId: draftRefId }).count())) throw new Error("Foto kondisi HP wajib ditambahkan sebelum menyimpan nota");
    const customer = await resolveTicketCustomer(user, data.customerName, data.phone, data.customerId);
    const noNota = await nextNota("ticket");
    const now = Date.now();
    const ticket: Ticket = {
      ...data,
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      id: requestId,
      noNota,
      garansiDari,
      biayaJasa: 0,
      hargaFinal: !!garansiDari,
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
        meta: { paymentKind: "dp" },
        note: `DP servis ${noNota} — ${ticket.customerName}`,
        refType: "ticket",
        refId: ticket.id,
      });
    }
    await logAudit(
      user,
      "buat",
      "servis",
      ticket.id,
      `Nota ${noNota}: ${data.brand} ${data.model} (${ticket.customerName})${garansiDari ? " [klaim garansi]" : ""}`,
    );
    if (draftRefId) {
      await db.photos.where({ refType: "draft", refId: draftRefId }).modify({ refType: "ticket", refId: ticket.id });
      await db.settings.put({ key: "draftServisBaru", value: "" });
    }
    return ticket;
  });
}

/** Buat tiket klaim garansi yang tertaut ke tiket asal. */
export async function createGaransiClaim(
  user: User,
  source: Ticket,
  keluhan: string,
): Promise<Ticket> {
  return operation(user, "service", async (user) => {
    source = await warrantySource(source.id);
    const t = await createTicket(
      user,
      {
        customerName: source.customerName,
        customerId: source.customerId,
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
  });
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
  return operation(user, "service", async (user) => {
    const previousStatus = ticket.status;
    const fresh = await db.tickets.get(ticket.id);
    if (!fresh || fresh.status !== previousStatus) throw new Error("Status servis sudah berubah. Periksa nota terbaru.");
    if (["konfirmasi", "dikerjakan", "diambil", "batal"].includes(status) && billingSnapshot(fresh) !== billingSnapshot(ticket)) throw new Error("Rincian biaya servis sudah berubah. Periksa nota terbaru sebelum melanjutkan.");
    ticket = fresh;
    if (status !== "batal" && !NEXT_ACTIONS[ticket.status].some((a) => a.to === status)) throw new Error("Perubahan status tidak diizinkan");
    if (["diambil", "batal"].includes(ticket.status)) throw new Error("Nota sudah ditutup");
    if (["diambil", "batal"].includes(status) && !can(user.role, "sell")) throw new Error("Pengambilan/pembatalan hanya untuk Kasir/Owner/Head Ops");
    if (opts.bayar !== undefined) amount(opts.bayar);
    if (opts.biayaJasa !== undefined) amount(opts.biayaJasa);
    const now = Date.now();
    const patch: Partial<Ticket> = {
      status,
      updatedAt: now,
      history: [
        ...ticket.history,
        { status, at: now, by: user.name, note: opts.note },
      ],
    };
    if (opts.biayaJasa !== undefined) { patch.biayaJasa = opts.biayaJasa; patch.hargaFinal = true; }

    if (status === "diambil") {
      const sisa = Math.max(0, ticketTotal({ ...ticket, ...patch } as Ticket) - ticket.dp);
      const bayar = Math.min(opts.bayar ?? sisa, sisa);
      const piutang = sisa - bayar;
      patch.piutang = piutang;
      if (piutang > 0) {
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
          meta: { paymentKind: "settlement" },
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
          meta: { paymentKind: "refund" },
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
  });
}

/** Ajukan harga, dengan opsi langsung bekerja dalam satu transaksi utuh. */
export async function submitServicePrice(
  user: User,
  ticket: Ticket,
  biayaJasa: number,
  startWork = false,
  note?: string,
) {
  return operation(user, "service", async (actor) => {
    if (ticket.status !== "dicek") throw new Error("Harga hanya dapat diajukan setelah pengecekan");
    await changeStatus(actor, ticket, "konfirmasi", { biayaJasa, note });
    if (startWork) {
      const confirmed = await db.tickets.get(ticket.id);
      if (!confirmed) throw new Error("Nota tidak ditemukan");
      await changeStatus(actor, confirmed, "dikerjakan", {
        note: "Harga disetujui pelanggan, langsung dikerjakan",
      });
    }
  });
}

/** Terima pembayaran piutang setelah unit diambil. */
export async function payPiutang(
  user: User,
  ticket: Ticket,
  amountPaid: number,
  method: CashMethod,
) {
  return operation(user, "sell", async (user) => {
    amount(amountPaid, "Pembayaran", true);
    const fresh = await db.tickets.get(ticket.id);
    if (!fresh || fresh.status !== "diambil" || (fresh.piutang ?? 0) !== (ticket.piutang ?? 0)) throw new Error("Piutang sudah berubah; periksa nota terbaru");
    ticket = fresh;
    const piutang = ticket.piutang ?? 0;
    const bayar = Math.min(amountPaid, piutang);
    if (bayar <= 0) return;
    await addCash(user, {
      type: "in",
      category: "servis",
      amount: bayar,
      method,
      meta: { paymentKind: "piutang" },
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
  });
}

/** Revisi biaya jasa setelah konfirmasi — wajib beralasan, tercatat di riwayat. */
export async function reviseJasa(
  user: User,
  ticket: Ticket,
  newJasa: number,
  reason: string,
) {
  return operation(user, "service", async (user) => {
    amount(newJasa); if (!reason.trim()) throw new Error("Alasan wajib diisi");
    const fresh = await db.tickets.get(ticket.id);
    if (!fresh || !["konfirmasi", "dikerjakan", "selesai"].includes(fresh.status)) throw new Error("Harga nota tidak dapat direvisi");
    if (fresh.status !== ticket.status || billingSnapshot(fresh) !== billingSnapshot(ticket)) throw new Error("Harga atau rincian servis sudah berubah. Periksa nota terbaru sebelum merevisi.");
    ticket = fresh;
    const old = ticketJasa(ticket);
    await db.tickets.update(ticket.id, {
      biayaJasa: newJasa,
      hargaFinal: true,
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
  });
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
  return operation(user, "service", async (user) => {
    const fresh = await db.tickets.get(ticket.id);
    if (!fresh) throw new Error("Nota tidak ditemukan");
    if (infoSnapshot(fresh) !== infoSnapshot(ticket)) throw new Error("Data nota sudah berubah. Periksa nota terbaru sebelum menyimpan ulang.");
    ticket = fresh;
    if (!patch.customerName.trim() || !patch.brand.trim() || !patch.keluhan.trim()) throw new Error("Data nota belum lengkap");
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
  });
}

/** Pakai sparepart dari stok ke tiket (stok berkurang otomatis). */
export async function usePart(
  user: User,
  ticket: Ticket,
  partId: string,
  qty: number,
) {
  return operation(user, "service", async (user) => {
    await db.transaction("rw", [db.parts, db.tickets, db.audit], async () => {
      amount(qty, "Jumlah part", true);
      const fresh = await db.tickets.get(ticket.id);
      if (!fresh || ["diambil", "batal"].includes(fresh.status)) throw new Error("Nota sudah ditutup");
      ticket = fresh;
      const part = await db.parts.get(partId);
      if (!part) throw new Error("Sparepart tidak ditemukan");
      if (part.stok < qty) throw new Error(`Stok ${part.nama} tinggal ${part.stok}`);
      await db.parts.update(partId, { stok: part.stok - qty });
      const used: PartUsed = {
        id: uid(),
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
  });
}

export async function removePart(user: User, ticket: Ticket, index: number) {
  return operation(user, "service", async (user) => {
    const fresh = await db.tickets.get(ticket.id);
    if (!fresh || ["diambil", "batal"].includes(fresh.status) || JSON.stringify(fresh.partsUsed) !== JSON.stringify(ticket.partsUsed)) throw new Error("Rincian part sudah berubah; periksa nota terbaru");
    ticket = fresh;
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
  });
}

/** Aksi status berikutnya yang masuk akal per status sekarang. */
export const NEXT_ACTIONS: Record<
  TicketStatus,
  { to: TicketStatus; label: string; }[]
> = {
  masuk: [{ to: "dicek", label: "Mulai Pengecekan" }],
  dicek: [{ to: "konfirmasi", label: "Ajukan Harga ke Pelanggan" }],
  konfirmasi: [{ to: "dikerjakan", label: "Disetujui, Kerjakan" }],
  dikerjakan: [{ to: "selesai", label: "Tandai Selesai" }],
  selesai: [{ to: "diambil", label: "Diambil & Bayar" }],
  diambil: [],
  batal: [],
};
