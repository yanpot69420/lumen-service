import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, Row } from "@/components/ui/misc";
import { Tag } from "@/components/ui/status-tag";
import { useToast } from "@/components/ui/toast";
import { decideCorrection } from "@/db/cash";
import { db } from "@/db/db";
import type { Correction } from "@/db/types";
import { fmtDateTime, rp } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardCheck } from "lucide-react";

export function KoreksiPage() {
  const user = useUser();
  const toast = useToast();
  const corrections = useLiveQuery(
    () => db.corrections.orderBy("at").reverse().toArray(),
    [],
  );
  const isOwner = user.role === "owner";

  async function decide(k: Correction, ok: boolean) {
    await decideCorrection(user, k.id, ok);
    toast(ok ? "Koreksi diterapkan" : "Koreksi ditolak");
  }

  const badge = (s: Correction["status"], direct = false) =>
    s === "pending" ? (
      <Tag className="bg-accent-100 text-accent-800">Menunggu</Tag>
    ) : s === "approved" ? (
      <Tag className="bg-brand-100 text-brand-800">{direct ? "Diterapkan" : "Disetujui"}</Tag>
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
          <div key={k.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 [overflow-wrap:anywhere]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {k.requestedByName}{" "}
                <span className="font-normal text-slate-400">
                  · {fmtDateTime(k.at)}
                </span>
              </p>
              {badge(k.status, !!k.after.purchase)}
            </div>
            <p className="mt-1 text-sm text-slate-600">Alasan: {k.reason}</p>
            <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm">
              {k.after.purchase && <div className="mb-2 border-b border-slate-200 pb-2"><p className="mb-1 text-xs font-semibold text-brand-700">{k.after.purchase.kind === "refund" ? "Pengembalian supplier" : "Koreksi pembelian"} · langsung diterapkan</p><Row label="Jumlah pembelian">{k.before.purchase?.qty} → <b>{k.after.purchase.qty} pcs</b></Row><Row label="Total biaya bersih">{rp(k.before.purchase?.totalCost ?? k.before.amount)} → <b>{rp(k.after.purchase.totalCost)}</b></Row><Row label="Stok">{k.before.purchase?.stock} → <b>{k.after.purchase.stock}</b></Row><Row label="Modal /pcs">{rp(k.before.purchase?.unitCost ?? 0)} → <b>{rp(k.after.purchase.unitCost)}</b></Row></div>}
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
                {k.after.purchase ? "Diterapkan oleh" : "Diputuskan"} {k.decidedByName} · {fmtDateTime(k.decidedAt!)}
              </p>
            )}
          </div>
        ))}
      </PageBody>
    </>
  );
}
