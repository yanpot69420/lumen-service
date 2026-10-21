import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string; }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black", className)}>
      <img src="/brand-logo.jpg" alt="" width={1254} height={1254} className="size-full scale-[1.35] object-contain" />
    </span>
  );
}
