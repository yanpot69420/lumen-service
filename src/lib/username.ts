/** Bentuk username dari nama: huruf kecil & angka saja. */
export function usernameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20);
}

export const USERNAME_RE = /^[a-z0-9._]{3,20}$/;
