import type { PublicStatus } from "@/db/public";

export interface PublicStatusLookupState {
  result: PublicStatus | "notfound" | null;
  busy: boolean;
  error: string;
}

export const emptyStatusLookup: PublicStatusLookupState = { result: null, busy: false, error: "" };

/** Ignore a response once the customer edits the form, searches again, or leaves. */
export function createPublicStatusLookup(
  find: (nota: string, suffix: string) => Promise<PublicStatus | null>,
  publish: (state: PublicStatusLookupState) => void,
) {
  let sequence = 0;
  return {
    clear() {
      sequence++;
      publish({ ...emptyStatusLookup });
    },
    cancel() { sequence++; },
    async search(nota: string, suffix: string) {
      const request = ++sequence;
      const clean = nota.trim().toUpperCase();
      if (!clean || !/^\d{4}$/.test(suffix)) {
        publish({ ...emptyStatusLookup });
        return;
      }
      publish({ result: null, busy: true, error: "" });
      try {
        const result = await find(clean, suffix);
        if (request === sequence) publish({ result: result ?? "notfound", busy: false, error: "" });
      } catch (error) {
        if (request === sequence) publish({ result: null, busy: false, error: error instanceof Error ? error.message : "Pencarian gagal. Silakan coba lagi." });
      }
    },
  };
}
