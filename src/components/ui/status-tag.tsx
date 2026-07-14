import { cn } from "@/lib/cn";
import type { TicketStatus, UnitStatus } from "@/db/types";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  masuk: "Masuk",
  dicek: "Dicek",
  konfirmasi: "Konfirmasi",
  dikerjakan: "Dikerjakan",
  selesai: "Selesai",
  diambil: "Diambil",
  batal: "Batal",
};

const ticketColors: Record<TicketStatus, string> = {
  masuk: "bg-slate-100 text-slate-700",
  dicek: "bg-sky-100 text-sky-800",
  konfirmasi: "bg-amber-100 text-amber-800",
  dikerjakan: "bg-indigo-100 text-indigo-800",
  selesai: "bg-emerald-100 text-emerald-800",
  diambil: "bg-emerald-600 text-white",
  batal: "bg-red-100 text-red-700",
};

export function TicketStatusTag({ status }: { status: TicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        ticketColors[status],
      )}
    >
      {TICKET_STATUS_LABEL[status]}
    </span>
  );
}

export function UnitStatusTag({ status }: { status: UnitStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "stok"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-slate-200 text-slate-600",
      )}
    >
      {status === "stok" ? "Stok" : "Terjual"}
    </span>
  );
}

export function Tag({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700",
        className,
      )}
    >
      {children}
    </span>
  );
}
