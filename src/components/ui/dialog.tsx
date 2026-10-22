import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { useDialog } from "./use-dialog";

export function Modal({
  open,
  onClose,
  title,
  children,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
}) {
  const ref = useDialog(open, onClose, busy);
  const titleId = useId();
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/50"
        onClick={() => { if (!busy) onClose(); }}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-modal
        aria-busy={busy}
        className="ui-modal relative flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Tutup"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 lg:size-8"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto p-5">
          <fieldset disabled={busy} className="min-w-0">{children}</fieldset>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Ya, lanjutkan",
  destructive,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const ref = useDialog(open, onCancel, busy);
  const titleId = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-slate-950/50"
        onClick={() => { if (!busy) onCancel(); }}
        aria-hidden
      />
      <div
        role="alertdialog"
        ref={ref}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-modal
        className="ui-modal relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        {children && (
          <div className="mt-2 text-sm text-slate-600">{children}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
