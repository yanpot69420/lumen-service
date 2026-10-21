export function rp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

export function dayKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const value = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function monthKey(d: Date = new Date()): string {
  return dayKey(d).slice(0, 7);
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString("id-ID", {
    timeZone: "Asia/Makassar",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleDateString("id-ID", {
    timeZone: "Asia/Makassar",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("id-ID", {
    timeZone: "Asia/Makassar",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysSince(t: number): number {
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function monthLabel(mk: string): string {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });
}

/** Parse input rupiah bebas ("1.500.000", "1500000") menjadi number. */
export function parseRp(s: string): number {
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
