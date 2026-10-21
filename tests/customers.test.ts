import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { customerTickets, saveCustomer } from "@/db/customers";
import { createGaransiClaim, createTicket } from "@/db/tickets";
import { exportBackup, restoreBackup } from "@/db/backup";
import { validateBackup } from "@/lib/backup-schema";
import type { Customer, Ticket, User } from "@/db/types";

const owner: User = { id: "owner", name: "Owner", username: "owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const cashier: User = { ...owner, id: "cashier", name: "Kasir", username: "kasir", role: "kasir" };
const technician: User = { ...owner, id: "technician", name: "Teknisi", username: "teknisi", role: "teknisi" };
const profile = { name: "Budi", phone: "081234567890", notes: "Suka dihubungi sore", isRegular: true };
const intake = { customerName: "Budi", phone: "081234567890", brand: "Samsung", model: "A15", keluhan: "LCD pecah", kelengkapan: ["SIM Tray"], estimasi: 0, dp: 0 };
const photo = () => [new Blob(["photo"], { type: "image/jpeg" })];

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, cashier, technician]);
});

/** Catch outside the nested Dexie transaction to avoid Bun's rejects matcher deadlock. */
async function failure(action: () => Promise<unknown>) {
  let result: unknown;
  try { await action(); }
  catch (error) { result = error; }
  expect(result).toBeInstanceOf(Error);
}

function legacy(id: string, name: string, phone: string, customerId?: string): Ticket {
  return { ...intake, id, noNota: `LS-${id}`, customerName: name, phone, customerId, biayaJasa: 0, status: "masuk", history: [], partsUsed: [], createdAt: 1, updatedAt: 1, createdBy: owner.id };
}

test("customer identity normalizes WA prefixes while shared family numbers stay distinct", async () => {
  const first = await saveCustomer(owner, profile);
  expect(first.phoneNormalized).toBe("6281234567890");
  expect(first.isRegular).toBe(true);
  await failure(() => saveCustomer(owner, { ...profile, name: "BUDI", phone: "+62 812-3456-7890" }));
  const family = await saveCustomer(owner, { ...profile, name: "Siti", phone: "+6281234567890" });
  expect(family.id).not.toBe(first.id);
  expect(await db.customers.count()).toBe(2);
});

test("concurrent intake reuses only the same normalized phone and customer name", async () => {
  const results = await Promise.all([
    createTicket(owner, intake, photo()),
    createTicket(owner, { ...intake, customerName: "BUDI", phone: "+62 812 3456 7890" }, photo()),
  ]);
  expect(await db.customers.count()).toBe(1);
  expect(results[0].customerId).toBeTruthy();
  expect(results[1].customerId).toBe(results[0].customerId);
  const another = await createTicket(owner, { ...intake, customerName: "Siti" }, photo());
  expect(another.customerId).not.toBe(results[0].customerId);
  expect(await db.customers.count()).toBe(2);
});

test("intake never merges same-name customers by a blank or different WA", async () => {
  const first = await createTicket(owner, { ...intake, phone: "" }, photo());
  const second = await createTicket(owner, { ...intake, phone: "" }, photo());
  const third = await createTicket(owner, { ...intake, phone: "081299990001" }, photo());
  const fourth = await createTicket(owner, { ...intake, phone: "081299990002" }, photo());
  expect(new Set([first, second, third, fourth].map((t) => t.customerId)).size).toBe(4);
  expect(await db.customers.count()).toBe(4);
});

test("selected profile resolves its latest saved name and WA instead of stale form values", async () => {
  const saved = await saveCustomer(owner, profile);
  await saveCustomer(owner, { ...profile, name: "Budi Santoso", phone: "081299991111" }, saved.id);
  const ticket = await createTicket(owner, { ...intake, customerId: saved.id }, photo());
  expect(ticket.customerId).toBe(saved.id);
  expect(ticket.customerName).toBe("Budi Santoso");
  expect(ticket.phone).toBe("081299991111");
  expect(await db.customers.count()).toBe(1);
  await failure(() => createTicket(owner, { ...intake, customerId: "missing-customer" }, photo()));
  expect(await db.tickets.count()).toBe(1);
});

test("editing customer profile keeps historical nota snapshots and linked service history", async () => {
  const saved = await saveCustomer(owner, profile);
  const ticket = await createTicket(owner, { ...intake, customerId: saved.id }, photo());
  const edited = await saveCustomer(cashier, { ...profile, name: "Budi Santoso", phone: "081299991111", isRegular: false }, saved.id);
  const historical = (await db.tickets.get(ticket.id))!;
  expect(historical.customerName).toBe(ticket.customerName);
  expect(historical.phone).toBe(ticket.phone);
  expect(edited.createdAt).toBe(saved.createdAt);
  expect(edited.createdBy).toBe(saved.createdBy);
  expect(customerTickets(edited, [historical], [edited]).map((t) => t.id)).toEqual([ticket.id]);
});

test("legacy history matches exact nonempty WA and name without borrowing explicitly linked tickets", async () => {
  const budi = await saveCustomer(owner, profile);
  const siti = await saveCustomer(owner, { ...profile, name: "Siti" });
  const tickets = [
    legacy("match", "BUDI", "+6281234567890"),
    legacy("family", "Siti", "081234567890"),
    legacy("wrong-number", "Budi", "081299990000"),
    legacy("blank", "Budi", ""),
    legacy("belongs-elsewhere", "Budi", "081234567890", siti.id),
    legacy("explicit", "Nama lama", "081200000000", budi.id),
  ];
  expect(customerTickets(budi, tickets, [budi, siti]).map((t) => t.id).sort()).toEqual(["explicit", "match"]);
  expect(customerTickets(siti, tickets, [budi, siti]).map((t) => t.id).sort()).toEqual(["belongs-elsewhere", "family"]);
});

test("ambiguous or blank legacy identity cannot be automatically assigned to a saved profile", async () => {
  const budi = await saveCustomer(owner, profile);
  // Simulate two historical/imported profiles with the same exact identity.
  const duplicate: Customer = { ...budi, id: "duplicate" };
  const blank: Customer = { ...budi, id: "blank-profile", phone: "", phoneNormalized: "" };
  const tickets = [legacy("ambiguous", "Budi", "081234567890"), legacy("blank", "Budi", "")];
  expect(customerTickets(budi, tickets, [budi, duplicate, blank])).toEqual([]);
  expect(customerTickets(blank, tickets, [budi, duplicate, blank])).toEqual([]);
});

test("technician cannot edit profiles but service intake can record a basic customer atomically", async () => {
  const saved = await saveCustomer(cashier, profile);
  await failure(() => saveCustomer(technician, { ...profile, name: "Diubah" }, saved.id));
  await failure(() => saveCustomer(technician, { ...profile, name: "Pelanggan baru" }));
  expect((await db.customers.get(saved.id))?.name).toBe("Budi");
  const ticket = await createTicket(technician, { ...intake, customerName: "Pelanggan Teknisi", phone: "081211112222" }, photo());
  expect(ticket.customerId).toBeTruthy();
  expect((await db.customers.get(ticket.customerId!))?.isRegular).toBe(false);
});

test("garansi claim keeps the source customer link", async () => {
  const customer = await saveCustomer(owner, profile);
  const source = await createTicket(owner, { ...intake, customerId: customer.id }, photo());
  const claim = await createGaransiClaim(owner, source, "LCD bermasalah lagi");
  expect(claim.customerId).toBe(customer.id);
  expect(claim.garansiDari).toBe(source.id);
  expect(await db.customers.count()).toBe(1);
});

test("audit failure rolls back customer, ticket, cash and their durable queue", async () => {
  db.syncCapture = true;
  const fail = () => { throw new Error("Simulated audit failure"); };
  db.audit.hook("creating", fail);
  try { await failure(() => createTicket(owner, { ...intake, dp: 20000 }, photo())); }
  finally { db.audit.hook("creating").unsubscribe(fail); }
  expect(await db.customers.count()).toBe(0);
  expect(await db.tickets.count()).toBe(0);
  expect(await db.cash.count()).toBe(0);
  expect(await db.audit.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});

test("profile edit and audit queue roll back together when audit fails", async () => {
  const saved = await saveCustomer(owner, profile);
  const audits = await db.audit.count();
  db.syncCapture = true;
  const fail = () => { throw new Error("Simulated profile audit failure"); };
  db.audit.hook("creating", fail);
  try { await failure(() => saveCustomer(owner, { ...profile, name: "Nama gagal" }, saved.id)); }
  finally { db.audit.hook("creating").unsubscribe(fail); }
  expect(await db.customers.get(saved.id)).toEqual(saved);
  expect(await db.audit.count()).toBe(audits);
  expect(await db.outbox.count()).toBe(0);
});

test("backup v4 roundtrip preserves profiles and customer links and requires the customer table", async () => {
  const customer = await saveCustomer(owner, profile);
  const ticket = await createTicket(owner, { ...intake, customerId: customer.id }, photo());
  const backup = await exportBackup();
  expect(backup.version).toBe(4);
  expect(backup.customers).toHaveLength(1);
  const incomplete = { ...backup } as Record<string, unknown>;
  delete incomplete.customers;
  expect(() => validateBackup(incomplete)).toThrow();
  await db.customers.update(customer.id, { name: "Sementara" });
  await restoreBackup(backup);
  expect(await db.customers.get(customer.id)).toEqual(customer);
  expect((await db.tickets.get(ticket.id))?.customerId).toBe(customer.id);
});

test("versions 1 to 3 backups without customer records remain restorable", async () => {
  const ticket = legacy("legacy-backup", "Pelanggan Lama", "081277778888");
  await db.tickets.add(ticket);
  const exported = await exportBackup();
  for (const version of [1, 2, 3]) {
    const old = { ...exported, version } as Record<string, unknown>;
    delete old.customers;
    expect(validateBackup(old).customers).toEqual([]);
  }
  const old = { ...exported, version: 3 } as Record<string, unknown>;
  delete old.customers;
  await restoreBackup(old);
  expect(await db.customers.count()).toBe(0);
  expect((await db.tickets.get(ticket.id))?.customerName).toBe(ticket.customerName);
});
