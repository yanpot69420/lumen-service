import type { OutboxEntry } from "./db";

export interface BlockedSyncAccount {
  userId?: string;
  name: string;
  count: number;
  reason: "account" | "dependency" | "unknown";
}
export interface QueuePlan {
  batch: OutboxEntry[];
  retryAt?: number;
  blocked: number;
  blockedAccounts: BlockedSyncAccount[];
}

/** Old journals have no actorId. Their audit records identify the operator,
 * unlike createdBy/by on an edited row, which identify the original creator. */
export function batchActor(batch: OutboxEntry[]): string | undefined {
  const explicit = new Set(batch.flatMap((entry) => entry.actorId ? [entry.actorId] : []));
  const audited = new Set(batch.flatMap((entry) => entry.table === "audit" && typeof entry.payload?.userId === "string" ? [entry.payload.userId] : []));
  const actors = new Set([...explicit, ...audited]);
  return actors.size === 1 ? [...actors][0] : undefined;
}

/** Include business references, not just identical row IDs. A later payment,
 * photo or stock usage must not overtake its still-local parent transaction. */
function resources(batch: OutboxEntry[]) {
  const keys = new Set<string>();
  const dependencies = new Set<string>();
  const add = (table: string, key: unknown) => { if (typeof key === "string" && key) keys.add(`${table}:${key}`); };
  for (const entry of batch) {
    add(entry.table, entry.key);
    for (const row of [entry.before, entry.payload]) {
      if (!row) continue;
      if (entry.table === "tickets") {
        add("customers", row.customerId); add("tickets", row.garansiDari);
        if (Array.isArray(row.partsUsed)) for (const part of row.partsUsed) add("parts", part?.partId);
      } else if (entry.table === "cash") {
        const table = row.refType === "ticket" ? "tickets" : row.refType === "part" ? "parts" : row.refType === "unit" ? "units" : "";
        if (table) add(table, row.refId);
        // Closing cash depends on all earlier local payments for that day.
        add("cashDay", row.dayKey);
        dependencies.add(`closeDay:${row.dayKey}`);
      } else if (entry.table === "dayCloses") {
        add("closeDay", row.dayKey);
        dependencies.add(`cashDay:${row.dayKey}`);
      }
      else if (entry.table === "corrections") {
        add("cash", row.entityId);
        for (const side of [row.before, row.after] as { purchase?: { partId?: string } }[]) add("parts", side?.purchase?.partId);
      } else if (entry.table === "photos") {
        add(row.refType === "ticket" ? "tickets" : "units", row.refId);
      }
    }
  }
  return { keys, dependencies: new Set([...dependencies, ...[...keys].filter((key) => !key.startsWith("cashDay:") && !key.startsWith("closeDay:"))]) };
}

export function planSyncQueue(entries: OutboxEntry[], actorId: string, names: Map<string, string> = new Map(), now = Date.now()): QueuePlan {
  const batches = new Map<string, OutboxEntry[]>();
  for (const entry of entries) {
    const key = entry.batchId ?? `legacy:${entry.seq}`;
    const batch = batches.get(key) ?? [];
    batch.push(entry); batches.set(key, batch);
  }
  const plan: QueuePlan = { batch: [], blocked: 0, blockedAccounts: [] };
  const withheld = new Set<string>();
  for (const batch of batches.values()) {
    const owner = batchActor(batch);
    const { keys, dependencies } = resources(batch);
    const reason = !owner || !batch[0].batchId ? "unknown" : owner !== actorId ? "account" : [...dependencies].some((key) => withheld.has(key)) ? "dependency" : undefined;
    if (reason) {
      plan.blocked += batch.length;
      const group = plan.blockedAccounts.find((item) => item.userId === owner && item.reason === reason);
      if (group) group.count += batch.length;
      else plan.blockedAccounts.push({ userId: owner, name: owner ? names.get(owner) ?? "Staf sebelumnya" : "Akun belum teridentifikasi", count: batch.length, reason });
      keys.forEach((key) => withheld.add(key));
      continue;
    }
    const notBefore = Math.max(...batch.map((entry) => entry.notBefore ?? 0));
    if (notBefore > now) {
      plan.retryAt = Math.min(plan.retryAt ?? notBefore, notBefore);
      keys.forEach((key) => withheld.add(key));
      continue;
    }
    if (!plan.batch.length) plan.batch = batch;
  }
  return plan;
}
