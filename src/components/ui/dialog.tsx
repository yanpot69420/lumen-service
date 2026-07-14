import type { ReactNode } from "react";
import { Button } from "./button";

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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-slate-950/50"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="alertdialog"
        aria-modal
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
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
