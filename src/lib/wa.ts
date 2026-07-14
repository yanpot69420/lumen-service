/** Normalisasi nomor Indonesia ke format 62xxx untuk wa.me. */
export function waPhone(phone: string): string {
  let p = phone.replace(/[^\d]/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  if (p.startsWith("8")) p = "62" + p;
  return p;
}

export function waLink(phone: string, text: string): string {
  const p = waPhone(phone);
  const base = p ? `https://wa.me/${p}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function fillTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
