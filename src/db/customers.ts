import { waPhone } from "@/lib/wa";
import { logAudit } from "./audit";
import { db, uid } from "./db";
import { operation } from "./operations";
import type { Customer, Ticket, User } from "./types";

export type CustomerInput = Pick<Customer, "name" | "phone" | "notes" | "isRegular">;
export const customerNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function contact(name: string, phone: string) {
  const cleanedName = name.trim().replace(/\s+/g, " ");
  const cleanedPhone = phone.trim();
  const phoneNormalized = waPhone(cleanedPhone);
  if (!cleanedName || cleanedName.length > 120) throw new Error("Nama pelanggan wajib diisi, maksimal 120 karakter");
  if (cleanedPhone.length > 40 || !/^\+?[\d\s()-]*$/.test(cleanedPhone) || (cleanedPhone && !/^\d{8,15}$/.test(phoneNormalized))) throw new Error("Nomor WhatsApp tidak valid (8–15 digit)");
  return { name: cleanedName, phone: cleanedPhone, phoneNormalized };
}

async function matchingCustomers(name: string, normalized: string) {
  if (!normalized) return [];
  return db.customers.where("phoneNormalized").equals(normalized).filter((c) => customerNameKey(c.name) === customerNameKey(name)).toArray();
}

export async function saveCustomer(user: User, input: CustomerInput, id?: string): Promise<Customer> {
  const identity = contact(input.name, input.phone);
  if (typeof input.isRegular !== "boolean" || typeof input.notes !== "string" || input.notes.length > 2000) throw new Error("Catatan pelanggan maksimal 2.000 karakter");
  return operation(user, "customers", async (actor) => {
    const current = id ? await db.customers.get(id) : undefined;
    if (id && !current) throw new Error("Pelanggan tidak ditemukan");
    if ((await matchingCustomers(identity.name, identity.phoneNormalized)).some((c) => c.id !== id)) throw new Error("Pelanggan dengan nama dan nomor WA ini sudah ada. Pilih profil yang sudah tersimpan.");
    const now = Date.now();
    const customer: Customer = {
      ...identity,
      id: current?.id ?? uid(),
      notes: input.notes.trim(),
      isRegular: input.isRegular,
      createdAt: current?.createdAt ?? now,
      createdBy: current?.createdBy ?? actor.id,
      updatedAt: now,
      ...(current?._version ? { _version: current._version } : {}),
    };
    await db.customers.put(customer);
    await logAudit(actor, current ? "ubah" : "buat", "pelanggan", customer.id, `${current ? "Ubah" : "Tambah"} pelanggan ${customer.name}${customer.isRegular ? " (langganan)" : ""}`);
    return customer;
  });
}

/** Called inside the ticket transaction; technicians can only create a plain profile here. */
export async function resolveTicketCustomer(user: User, name: string, phone: string, id?: string): Promise<Customer> {
  if (id) {
    const customer = await db.customers.get(id);
    if (!customer) throw new Error("Profil pelanggan tidak ditemukan. Pilih pelanggan kembali.");
    return customer;
  }
  const identity = contact(name, phone);
  const matches = await matchingCustomers(identity.name, identity.phoneNormalized);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error("Ada profil pelanggan ganda. Pilih pelanggan secara langsung.");
  const now = Date.now();
  const customer: Customer = { ...identity, id: uid(), notes: "", isRegular: false, createdAt: now, updatedAt: now, createdBy: user.id };
  await db.customers.add(customer);
  await logAudit(user, "buat", "pelanggan", customer.id, `Tambah pelanggan ${customer.name} dari nota servis`);
  return customer;
}

/** Existing ticket snapshots are never edited when a customer profile changes. */
export function customerTickets(customer: Customer, tickets: Ticket[], customers: Customer[]): Ticket[] {
  const identityUnique = customer.phoneNormalized && customers.filter((c) => c.phoneNormalized === customer.phoneNormalized && customerNameKey(c.name) === customerNameKey(customer.name)).length === 1;
  return tickets.filter((ticket) => ticket.customerId
    ? ticket.customerId === customer.id
    : identityUnique && waPhone(ticket.phone) === customer.phoneNormalized && customerNameKey(ticket.customerName) === customerNameKey(customer.name),
  ).sort((a, b) => b.createdAt - a.createdAt);
}
