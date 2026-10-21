import { cn } from "@/lib/cn";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "success" | "error" | "info";
export interface ToastOptions {
  kind?: ToastKind;
  /** Milliseconds; use 0 for a status that stays until updated or dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void>; };
  onDismiss?: () => void;
}
export interface ToastApi {
  (message: string, kindOrOptions?: ToastKind | ToastOptions): number;
  update: (id: number, message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}
interface ToastItem {
  id: number;
  revision: number;
  kind: ToastKind;
  message: string;
  action?: ToastOptions["action"];
  onDismiss?: () => void;
  expiresAt: number;
  busy: boolean;
}

const noop = () => { };
const Ctx = createContext<ToastApi>(Object.assign(() => 0, { update: noop, dismiss: noop }));
let nextId = 1;

function itemOptions(options: ToastOptions) {
  const duration = options.duration ?? (options.action ? 8000 : 3200);
  return {
    kind: options.kind ?? "success",
    action: options.action,
    onDismiss: options.onDismiss,
    expiresAt: duration === 0 ? Infinity : Date.now() + Math.max(0, duration),
  };
}

function cleanup(item: ToastItem) {
  try { item.onDismiss?.(); }
  catch (error) { console.error("Snackbar cleanup failed", error); }
}

export function ToastProvider({ children }: { children: ReactNode; }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const records = useRef(new Map<number, ToastItem>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  const publish = useCallback(() => {
    if (mounted.current) setItems([...records.current.values()]);
  }, []);

  const dismiss = useCallback((id: number) => {
    const item = records.current.get(id);
    if (!item) return;
    records.current.delete(id);
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    cleanup(item);
    publish();
  }, [publish]);

  const schedule = useCallback((item: ToastItem) => {
    clearTimeout(timers.current.get(item.id));
    timers.current.delete(item.id);
    if (!Number.isFinite(item.expiresAt)) return;
    const timer = setTimeout(() => {
      timers.current.delete(item.id);
      const current = records.current.get(item.id);
      if (!current || current.revision !== item.revision) return;
      if (current.busy) {
        // A started operation may finish, but its button can never be used again.
        records.current.set(item.id, { ...current, action: undefined });
        publish();
      } else dismiss(item.id);
    }, Math.max(0, item.expiresAt - Date.now()));
    timers.current.set(item.id, timer);
  }, [dismiss, publish]);

  const update = useCallback((id: number, message: string, options: ToastOptions = {}) => {
    const previous = records.current.get(id);
    if (!previous || !mounted.current) return;
    const item: ToastItem = {
      id,
      message,
      revision: previous.revision + 1,
      busy: false,
      ...itemOptions(options),
      onDismiss: options.onDismiss ?? previous.onDismiss,
    };
    records.current.set(id, item);
    schedule(item);
    publish();
  }, [publish, schedule]);

  const toast = useMemo<ToastApi>(() => Object.assign(
    (message: string, kindOrOptions: ToastKind | ToastOptions = "success") => {
      if (!mounted.current) return 0;
      const options = typeof kindOrOptions === "string" ? { kind: kindOrOptions } : kindOrOptions;
      const item: ToastItem = { id: nextId++, revision: 0, message, busy: false, ...itemOptions(options) };
      records.current.set(item.id, item);
      schedule(item);
      publish();
      return item.id;
    },
    { update, dismiss },
  ), [dismiss, publish, schedule, update]);

  const act = useCallback(async (id: number) => {
    const item = records.current.get(id);
    if (!item?.action || item.busy) return;
    // Timers can be throttled in a background tab, so also check the actual deadline.
    if (Date.now() >= item.expiresAt) {
      dismiss(id);
      return;
    }
    records.current.set(id, { ...item, busy: true });
    publish();
    try {
      await item.action.onClick();
      // The callback can replace this row with its own result status.
      if (records.current.get(id)?.revision === item.revision) dismiss(id);
    } catch (error) {
      if (records.current.get(id)?.revision === item.revision) {
        update(id, error instanceof Error ? error.message : "Pembatalan belum berhasil. Coba lagi.", { kind: "error" });
      } else if (mounted.current) {
        toast(error instanceof Error ? error.message : "Pembatalan belum berhasil. Coba lagi.", "error");
      }
    }
  }, [dismiss, publish, toast, update]);

  useLayoutEffect(() => {
    mounted.current = true;
    publish();
    return () => {
      mounted.current = false;
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      const dismissed = [...records.current.values()];
      records.current.clear();
      for (const item of dismissed) cleanup(item);
    };
  }, [publish]);

  useEffect(() => {
    const handle = (event: PromiseRejectionEvent) => {
      toast(event.reason instanceof Error ? event.reason.message : "Tindakan belum berhasil. Coba lagi.", "error");
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handle);
    return () => window.removeEventListener("unhandledrejection", handle);
  }, [toast]);

  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 className="size-4 text-brand-200" />,
    error: <AlertTriangle className="size-4 text-red-400" />,
    info: <Info className="size-4 text-brand-200" />,
  };

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" aria-relevant="additions text" className="snackbar-stack pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[70] flex max-h-[min(45dvh,22rem)] flex-col items-center gap-2 overflow-y-auto px-4 lg:bottom-6">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "pointer-events-auto flex w-full max-w-lg shrink-0 items-center gap-2 rounded-xl bg-brand-950 px-3 py-2.5 text-sm text-white shadow-lg",
            )}
          >
            <span className="shrink-0" aria-hidden="true">{item.busy ? <LoaderCircle className="size-4 animate-spin text-accent-400" /> : icons[item.kind]}</span>
            <span className="min-w-0 flex-1 break-words">{item.busy ? "Membatalkan…" : item.message}</span>
            {item.action && (
              <button type="button" disabled={item.busy} onClick={() => void act(item.id)} className="shrink-0 rounded-lg px-2 py-2 font-semibold text-accent-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300 disabled:opacity-50">
                {item.action.label}
              </button>
            )}
            <button type="button" aria-label="Tutup pemberitahuan" disabled={item.busy} onClick={() => dismiss(item.id)} className="shrink-0 rounded-lg p-2 text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
