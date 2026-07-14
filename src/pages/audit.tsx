import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ScrollText } from "lucide-react";
import { db } from "@/db/db";
import { fmtDateTime } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";

export function AuditPage() {
  const [q, setQ] = useState("");
  const entries = useLiveQuery(
    () => db.audit.orderBy("at").reverse().limit(300).toArray(),
    [],
  );
  const filtered = entries?.filter((e) => {
    if (!q) return true;
    return `${e.userName} ${e.action} ${e.entity} ${e.summary}`
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  return (
    <>
      <PageHeader title="Audit Log" />
      <PageBody>
        <Input
          placeholder="Cari aktivitas / nama…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="text-xs text-slate-400">
          Setiap aksi tercatat otomatis dan tidak bisa dihapus — pelindung kedua belah pihak.
        </p>
        {filtered?.length === 0 && (
          <EmptyState icon={<ScrollText />} title="Belum ada aktivitas" />
        )}
        <div className="space-y-2">
          {filtered?.map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{e.userName}</span>
                <Tag>{e.entity}</Tag>
                <span className="ml-auto text-xs text-slate-400">
                  {fmtDateTime(e.at)}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{e.summary}</p>
            </div>
          ))}
        </div>
      </PageBody>
    </>
  );
}
