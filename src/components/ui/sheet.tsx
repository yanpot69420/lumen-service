import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useDialog } from "./use-dialog";

/** Bottom sheet di mobile, panel kanan di desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useDialog(open, onClose);
  const titleId = useId();

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-950/50"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        ref={ref}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-modal
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl",
          "lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:rounded-none lg:rounded-l-2xl lg:pb-0",
          wide ? "lg:w-[560px]" : "lg:w-[420px]",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-200 lg:hidden" aria-hidden />
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:size-8"
            aria-label="Tutup"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
