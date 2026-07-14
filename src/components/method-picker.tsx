import type { CashMethod } from "@/db/types";
import { METHOD_LABEL } from "@/db/money";
import { cn } from "@/lib/cn";

const METHODS: CashMethod[] = ["tunai", "qris", "transfer"];

export function MethodPicker({
  value,
  onChange,
}: {
  value: CashMethod;
  onChange: (m: CashMethod) => void;
}) {
  return (
    <div className="grid grid-cols-3 rounded-xl bg-slate-200/70 p-1 text-sm font-medium">
      {METHODS.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "rounded-lg py-2 transition-colors",
            value === m ? "bg-white shadow-sm" : "text-slate-500",
          )}
        >
          {METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

export function MethodTag({ method }: { method: CashMethod }) {
  if (method === "tunai") return null;
  return (
    <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
      {METHOD_LABEL[method]}
    </span>
  );
}
