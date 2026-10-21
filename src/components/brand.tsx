import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string; }) {
  return <span aria-hidden className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent-500 text-xl font-black tracking-tight text-brand-950", className)}>L<span className="text-white">.</span></span>;
}
