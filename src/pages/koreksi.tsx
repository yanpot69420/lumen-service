import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardCheck } from "lucide-react";
import { db } from "@/db/db";
import type { Correction } from "@/db/types";
import { CASH_CATEGORY_LABEL } from "@/db/cash";
import { logAudit } from "@/db/audit";
import { useUser } from "@/auth/session";
import { rp, fmtDateTime } from "@/lib/format";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, Row } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";
import { useToast } from "@/components/ui/toast";

export function KoreksiPage() {
  const user = useUser();
  const toast = useToast();
  const corrections = useLiveQuery(
    () => db.corrections.orderBy("at").reverse().toArray(),
    [],
  );
  const isOwner = user.role === "owner";

  async function decide(k: Correction, ok: boolean) {
    await db.corrections.update(k.id, {
      status: ok ? "approved" : "rejected",
      decidedBy: user.id,
      decidedByName: user.name,
      decidedAt: Date.now(),
    });
    if (ok) await db.cash.update(k.entityId, k.after);
    await logAudit(
      user,
      "koreksi",
      "kas",
      k.entityId,
      `${ok ? "Setujui" : "Tolak"} koreksi dari ${k.requestedByName}: ${k.reason}`,
    );
    toast(ok ? "Koreksi diterapkan" : "Koreksi ditolak");
  }

  const badge = (s: Correction["status"]) =>
    s === "pending" ? (
      <Tag className="bg-amber-100 text-amber-800">Menunggu</Tag>
    ) : s === "approved" ? (
      <Tag className="bg-emerald-100 text-emerald-800">Disetujui</Tag>
    ) : (
      <Tag className="bg-red-100 text-red-700">Ditolak</Tag>
    );

  return (
    <>
      <PageHeader title="Jurnal Koreksi" />
      <PageBody>
        {corrections?.length === 0 && (
          <EmptyState
            icon={<ClipboardCheck />}
            title="Belum ada koreksi"
            hint="Koreksi transaksi kas diajukan dari halaman Kas (tombol ✎)."
          />
        )}
        {corrections?.map((k) => (
          <div key={k.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {k.requestedByName}{" "}
                <span className="font-normal text-slate-400">
                  · {fmtDateTime(k.at)}
                </span>
              </p>
              {badge(k.status)}
            </div>
            <p className="mt-1 text-sm text-slate-600">Alasan: {k.reason}</p>
            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm">
              {k.after.voided === 1 ? (
                <p className="font-medium text-red-600">
                  Pembatalan transaksi {rp(k.before.amount)} — {k.before.note}
                </p>
              ) : (
                <>
                  <Row label="Nominal">
                    {rp(k.before.amount)} → <b>{rp(k.after.amount)}</b>
                  </Row>
                  {k.before.note !== k.after.note && (
                    <Row label="Keterangan">
                      {k.before.note || "-"} → <b>{k.after.note}</b>
                    </Row>
                  )}
                </>
              )}
            </div>
            {k.status === "pending" && isOwner && (
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" size="sm" onClick={() => decide(k, true)}>
                  Setujui & Terapkan
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  size="sm"
                  onClick={() => decide(k, false)}
                >
                  Tolak
                </Button>
              </div>
            )}
            {k.status !== "pending" && k.decidedByName && (
              <p className="mt-2 text-xs text-slate-400">
                Diputuskan {k.decidedByName} · {fmtDateTime(k.decidedAt!)}
              </p>
            )}
          </div>
        ))}
      </PageBody>
    </>
  );
}
