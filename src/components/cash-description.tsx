import { CASH_CATEGORY_LABEL } from "@/db/cash";
import type { CashEntry, Part } from "@/db/types";
import { cn } from "@/lib/cn";

/** Resolve by the immutable item ID; the recorded description stays historical. */
export function CashDescription({ entry, part }: { entry: CashEntry; part?: Pick<Part, "id" | "nama">; }) {
  const currentPart = entry.refType === "part" && entry.refId === part?.id ? part : undefined;
  const original = entry.note || CASH_CATEGORY_LABEL[entry.category];
  const prefix = entry.meta?.purchaseRefundFor ? "Pengembalian supplier" : CASH_CATEGORY_LABEL[entry.category];
  const title = currentPart ? `${prefix} · ${currentPart.nama}` : original;
  return <div className="min-w-0">
    <p title={title} className={cn("line-clamp-2 break-words text-sm font-semibold leading-relaxed", entry.voided === 1 && "line-through")}>{title}</p>
    {currentPart && <details className="mt-1 text-xs text-slate-500">
      <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">Keterangan transaksi</summary>
      <p className="mt-1 break-words leading-relaxed">Keterangan saat dicatat: {original}</p>
    </details>}
  </div>;
}
