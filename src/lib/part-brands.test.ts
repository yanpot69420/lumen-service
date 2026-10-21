import { expect, test } from "bun:test";
import { getPartBrand, normalizePartBrand } from "./part-brands";

test("legacy names resolve brand aliases without guessing compatibility", () => {
  expect(getPartBrand({ nama: "LCD Samsung A12" })).toBe("Samsung");
  expect(getPartBrand({ nama: "Baterai APPLE iPhone 11" })).toBe("Apple");
  expect(getPartBrand({ nama: "LCD Redmi / POCO" })).toBe("Xiaomi");
  expect(getPartBrand({ nama: "LCD Samsung dan vivo" })).toBe("Lainnya");
  expect(getPartBrand({ nama: "Charger USB-C" })).toBe("Lainnya");
});
test("explicit classification takes priority over a device name", () => {
  expect(getPartBrand({ nama: "Kabel Samsung", brand: "Universal" })).toBe("Universal");
  expect(getPartBrand({ nama: "LCD Redmi", brand: "vivo" })).toBe("Vivo");
  expect(normalizePartBrand("  Vivo ")).toBe("Vivo");
  expect(normalizePartBrand("Redmi")).toBe("Xiaomi");
});

test("old categories collapse into the requested ten labels", () => {
  expect(normalizePartBrand("ASUS")).toBe("Lainnya");
  expect(getPartBrand({ nama: "LCD", brand: "iPhone" })).toBe("Apple");
  expect(normalizePartBrand("TECNO")).toBe("Tecno");
  expect(normalizePartBrand("OPPO")).toBe("Oppo");
});
