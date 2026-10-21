export const PART_BRANDS = [
  "Samsung", "Apple", "Vivo", "Oppo", "Xiaomi", "Realme", "Infinix", "Tecno", "Universal", "Lainnya",
] as const;

export function normalizePartBrand(value: string): string | undefined {
  const clean = value.trim().toLowerCase();
  if (["apple", "iphone"].includes(clean)) return "Apple";
  if (["redmi", "poco", "xiaomi"].includes(clean)) return "Xiaomi";
  if (["itel", "asus", "nokia", "huawei", "honor", "sony", "lenovo", "motorola", "google", "oneplus", "nothing", "advan", "zte"].includes(clean)) return "Lainnya";
  return PART_BRANDS.find((brand) => brand.toLowerCase() === clean);
}

/** Old rows have no brand property. Infer only an unambiguous brand token. */
export function getPartBrand(part: { nama: string; brand?: string | null }): string {
  if (typeof part.brand === "string") return normalizePartBrand(part.brand) ?? "Lainnya";
  const tokens = part.nama.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const brands = new Set(tokens.map(normalizePartBrand).filter((brand): brand is string => !!brand));
  return brands.size === 1 ? [...brands][0] : "Lainnya";
}
