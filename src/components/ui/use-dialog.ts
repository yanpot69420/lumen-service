import { useEffect, useRef } from "react";
const stack: symbol[] = [];
let originalOverflow = "";
export function useDialog(open: boolean, close: () => void, busy = false) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ close, busy }); latest.current = { close, busy };
  useEffect(() => {
    if (!open) return;
    const token = Symbol(); const previous = document.activeElement as HTMLElement | null;
    if (!stack.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    stack.push(token);
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? [])].filter((e) => e.getClientRects().length > 0);
    (focusable()[0] ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (stack.at(-1) !== token) return;
      if (e.key === "Escape") { e.preventDefault(); if (!latest.current.busy) latest.current.close(); }
      if (e.key === "Tab") {
        const list = focusable(); const first = list[0]; const last = list.at(-1);
        if (!first) { e.preventDefault(); ref.current?.focus(); }
        else if (!ref.current?.contains(document.activeElement) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      const index = stack.indexOf(token); if (index >= 0) stack.splice(index, 1);
      if (!stack.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return ref;
}
