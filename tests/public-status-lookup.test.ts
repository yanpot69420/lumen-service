import { expect, test } from "bun:test";
import type { PublicStatus } from "../src/db/public";
import { createPublicStatusLookup, emptyStatusLookup, type PublicStatusLookupState } from "../src/lib/public-status-lookup";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const status = (noNota: string): PublicStatus => ({ noNota, brand: "Samsung", model: "A15", status: "dicek", total: 0, dp: 0, sisa: 0, history: [] });

test("public lookup normalizes nota and requires exactly four numeric WA digits", async () => {
  const calls: string[][] = [];
  let visible: PublicStatusLookupState = emptyStatusLookup;
  const lookup = createPublicStatusLookup(async (nota, suffix) => { calls.push([nota, suffix]); return null; }, (next) => { visible = next; });
  for (const suffix of ["", "123", "12345", "abcd"]) await lookup.search("LS-EXAMPLE", suffix);
  await lookup.search(" ", "1234");
  expect(calls).toEqual([]);
  await lookup.search("  ls-abcdefgh2345  ", "1234");
  expect(calls).toEqual([["LS-ABCDEFGH2345", "1234"]]);
  expect(visible).toEqual({ result: "notfound", busy: false, error: "" });
});

test("a slow older public search cannot replace a newer ticket result", async () => {
  const first = deferred<PublicStatus | null>();
  const second = deferred<PublicStatus | null>();
  let visible: PublicStatusLookupState = emptyStatusLookup;
  const lookup = createPublicStatusLookup((nota) => nota === "LS-FIRST" ? first.promise : second.promise, (next) => { visible = next; });
  const oldRequest = lookup.search("LS-FIRST", "1234");
  const newRequest = lookup.search("LS-SECOND", "5678");
  second.resolve(status("LS-SECOND"));
  await newRequest;
  expect(visible.result).toEqual(status("LS-SECOND"));
  first.resolve(status("LS-FIRST"));
  await oldRequest;
  expect(visible).toEqual({ result: status("LS-SECOND"), busy: false, error: "" });
});

test("editing public lookup fields clears results and invalidates in-flight replies", async () => {
  const pending = deferred<PublicStatus | null>();
  let visible: PublicStatusLookupState = emptyStatusLookup;
  const lookup = createPublicStatusLookup(() => pending.promise, (next) => { visible = next; });
  const request = lookup.search("LS-FIRST", "1234");
  expect(visible.busy).toBe(true);
  lookup.clear();
  expect(visible).toEqual(emptyStatusLookup);
  pending.resolve(status("LS-FIRST"));
  await request;
  expect(visible).toEqual(emptyStatusLookup);
});

test("failed new searches show no previous ticket and stale errors cannot erase newer success", async () => {
  const oldFailure = deferred<PublicStatus | null>();
  let visible: PublicStatusLookupState = emptyStatusLookup;
  const lookup = createPublicStatusLookup((nota) => nota === "LS-OLD" ? oldFailure.promise : nota === "LS-ERROR" ? Promise.reject(new Error("Cloud tidak tersedia")) : Promise.resolve(status(nota)), (next) => { visible = next; });
  const oldRequest = lookup.search("LS-OLD", "1234");
  await lookup.search("LS-NEW", "5678");
  oldFailure.reject(new Error("Respons lama gagal"));
  await oldRequest;
  expect(visible.result).toEqual(status("LS-NEW"));
  expect(visible.error).toBe("");
  await lookup.search("LS-ERROR", "5678");
  expect(visible).toEqual({ result: null, busy: false, error: "Cloud tidak tersedia" });
});

test("leaving the public lookup page prevents late response updates", async () => {
  const pending = deferred<PublicStatus | null>();
  const states: PublicStatusLookupState[] = [];
  const lookup = createPublicStatusLookup(() => pending.promise, (next) => states.push(next));
  const request = lookup.search("LS-FIRST", "1234");
  lookup.cancel();
  pending.resolve(status("LS-FIRST"));
  await request;
  expect(states).toEqual([{ result: null, busy: true, error: "" }]);
});
