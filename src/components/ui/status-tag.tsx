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
  dicek: "bg-brand-100 text-brand-800",
  konfirmasi: "bg-accent-100 text-accent-800",
  dikerjakan: "bg-accent-100 text-accent-800",
  selesai: "bg-brand-200 text-brand-900",
  diambil: "bg-brand-800 text-white",
  batal: "bg-slate-200 text-slate-600",
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
          ? "bg-brand-100 text-brand-800"
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
