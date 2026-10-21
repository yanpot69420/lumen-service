export const BRAND_NAME = "D&R GadgetCare";

/** Keep saved shop names, while replacing the original application's default. */
export function storeDisplayName(name?: string | null): string {
  const value = name?.trim();
  return !value || /^lumen\s+service$/i.test(value) ? BRAND_NAME : value;
}
