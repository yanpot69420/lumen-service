import { describe, expect, test } from "bun:test";
import { luhnValidImei } from "./imei";

describe("luhnValidImei", () => {
  test("IMEI valid lolos", () => {
    expect(luhnValidImei("490154203237518")).toBe(true);
  });
  test("digit cek salah ditolak", () => {
    expect(luhnValidImei("490154203237519")).toBe(false);
  });
  test("panjang bukan 15 ditolak", () => {
    expect(luhnValidImei("49015420323751")).toBe(false);
    expect(luhnValidImei("4901542032375181")).toBe(false);
    expect(luhnValidImei("abc")).toBe(false);
  });
});
