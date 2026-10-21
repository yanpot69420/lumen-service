import { waPhone } from "./wa";

export const PHONE_BRANDS = [
  "Samsung", "iPhone", "Apple", "Xiaomi", "Redmi", "POCO", "OPPO", "vivo",
  "realme", "Infinix", "TECNO", "itel", "ASUS", "Nokia", "Huawei", "Honor",
  "OnePlus", "Google", "Sony", "Lenovo", "Motorola", "Nothing", "Advan",
  "Evercoss", "ZTE", "Black Shark",
];

export const COMPLAINTS = ["LCD pecah", "Baterai boros", "Mati total", "Tidak bisa cas", "Kena air"];

export type DeviceChoice = { brand: string; model: string };
export type CustomerChoice = { customerName: string; phone: string; createdAt: number; id?: string; isRegular?: boolean };

export function deviceLabel(device: DeviceChoice): string {
  return `${device.brand.trim()} ${device.model.trim()}`.trim();
}

/** Preserve historical brand/model boundaries before parsing a new device. */
export function parseDevice(value: string, known: DeviceChoice[] = []): DeviceChoice {
  const clean = value.trim().replace(/\s+/g, " ");
  const existing = known.find((d) => deviceLabel(d).toLowerCase() === clean.toLowerCase());
  if (existing) return { brand: existing.brand, model: existing.model };
  const brand = [...PHONE_BRANDS].sort((a, b) => b.length - a.length).find(
    (b) => clean.toLowerCase() === b.toLowerCase() || clean.toLowerCase().startsWith(`${b.toLowerCase()} `),
  );
  if (brand) return { brand, model: clean.slice(brand.length).trim() };
  const [first = "", ...rest] = clean.split(" ");
  return { brand: first, model: rest.join(" ") };
}

/** Keep shared numbers with different names separate; newest spelling wins. */
export function customerChoices(rows: CustomerChoice[]): CustomerChoice[] {
  const unique = new Map<string, CustomerChoice>();
  for (const row of [...rows].sort((a, b) => b.createdAt - a.createdAt)) {
    if (!row.customerName.trim()) continue;
    const key = `${waPhone(row.phone)}|${row.customerName.trim().toLocaleLowerCase("id")}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

export function findCustomers(rows: CustomerChoice[], value: string): CustomerChoice[] {
  const query = value.trim().toLocaleLowerCase("id");
  if (query.length < 2) return [];
  const isPhone = /^[+\d\s()-]+$/.test(query);
  const digits = waPhone(query);
  if (isPhone && digits.length < 4) return [];
  return rows.filter((row) => isPhone
    ? waPhone(row.phone).includes(digits)
    : row.customerName.toLocaleLowerCase("id").includes(query),
  ).slice(0, 5);
}

/** Exact matching only: a partial/shared number must never fill the wrong name. */
export function customerForPhone(rows: CustomerChoice[], phone: string): CustomerChoice | undefined {
  const normalized = waPhone(phone);
  if (normalized.length < 8) return undefined;
  const matches = rows.filter((row) => waPhone(row.phone) === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

export function complaintText(selected: string[], note: string): string {
  return [selected.join(", "), note.trim()].filter(Boolean).join("\n");
}
