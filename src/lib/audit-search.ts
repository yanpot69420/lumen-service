import { db } from "@/db/db";

export const AUDIT_PAGE_SIZE = 50;
export async function searchAudit({ query = "", from = "", to = "", page = 0, size = AUDIT_PAGE_SIZE }: { query?: string; from?: string; to?: string; page?: number; size?: number; }) {
  const start = from ? Date.parse(`${from}T00:00:00+08:00`) : -Infinity;
  const end = to ? Date.parse(`${to}T00:00:00+08:00`) + 86_400_000 : Infinity;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return { entries: [], hasMore: false };
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  const pageSize = Math.max(1, Math.min(100, Math.floor(size)));
  // Filter before pagination: older records remain searchable without loading
  // the entire audit history into memory or truncating it to the newest 300.
  const rows = await db.audit.where("at").between(start, end, true, false).reverse()
    .and((entry) => !normalized || `${entry.userName} ${entry.action} ${entry.entity} ${entry.summary}`.toLocaleLowerCase("id-ID").includes(normalized))
    .offset(Math.max(0, Math.floor(page)) * pageSize).limit(pageSize + 1).toArray();
  return { entries: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
