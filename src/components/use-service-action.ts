import { useUser } from "@/auth/session";
import { useToast } from "@/components/ui/toast";
import { undoServiceChange, withServiceUndo } from "@/db/undo";
import { useCallback, useMemo } from "react";

interface ServiceActionOptions<T> {
  pending: string;
  success: string | ((value: T) => string);
  beforeUndo?: () => void | Promise<void>;
  onUndoBusy?: (busy: boolean) => void;
  onUndo?: () => void | Promise<void>;
}

export function useServiceAction() {
  const user = useUser();
  const toast = useToast();
  const run = useCallback(async <T,>(action: () => Promise<T>, options: ServiceActionOptions<T>): Promise<T> => {
    const id = toast(options.pending, { kind: "info", duration: 0 });
    try {
      const result = await withServiceUndo(user, options.pending.replace(/[…\s.]+$/, ""), action);
      const message = typeof options.success === "function" ? options.success(result.value) : options.success;
      const undo = result.undo;
      toast.update(id, message, undo ? {
        duration: Math.max(1, undo.expiresAt - Date.now()),
        action: { label: "Undo", onClick: async () => {
          options.onUndoBusy?.(true);
          try {
            await options.beforeUndo?.();
            await undoServiceChange(user, undo.id, options.beforeUndo);
            // Local form restoration happens only after the database rollback.
            await options.onUndo?.();
            toast.update(id, "Perubahan dibatalkan", { kind: "success" });
          } finally {
            options.onUndoBusy?.(false);
          }
        } },
      } : {});
      return result.value;
    } catch (error) {
      toast.update(id, error instanceof Error ? error.message : "Perubahan belum berhasil disimpan", { kind: "error" });
      throw error;
    }
  }, [toast, user]);
  return useMemo(() => ({ run }), [run]);
}
