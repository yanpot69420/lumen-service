import { expect, test } from "bun:test";
import { complaintText, customerChoices, customerForPhone, findCustomers, parseDevice } from "./service-intake";

test("customer search unifies Indonesian phone formats and keeps the latest record", () => {
  const customers = customerChoices([
    { customerName: "Budi", phone: "0812 3456 7890", createdAt: 1 },
    { customerName: "BUDI", phone: "+62 812-3456-7890", createdAt: 2 },
  ]);
  expect(customers).toHaveLength(1);
  expect(findCustomers(customers, "08123456")[0]?.customerName).toBe("BUDI");
  expect(customerForPhone(customers, "81234567890")?.customerName).toBe("BUDI");
  expect(customerForPhone(customers, "08123456")).toBeUndefined();
});

test("shared phone numbers require choosing the customer instead of guessing", () => {
  const customers = customerChoices([
    { customerName: "Budi", phone: "081234567890", createdAt: 1 },
    { customerName: "Sari", phone: "+6281234567890", createdAt: 2 },
  ]);
  expect(customerForPhone(customers, "081234567890")).toBeUndefined();
  expect(findCustomers(customers, "081234567890")).toHaveLength(2);
  expect(findCustomers(customers, "sar")[0]?.customerName).toBe("Sari");
});

test("blank phone numbers do not match every customer", () => {
  const customers = customerChoices([{ customerName: "Budi", phone: "", createdAt: 1 }]);
  expect(findCustomers(customers, "")).toHaveLength(0);
  expect(customerForPhone(customers, "")).toBeUndefined();
});

test("combined device input preserves multi-word historical brands and accepts new models", () => {
  expect(parseDevice("  samsung   Galaxy A54 ")).toEqual({ brand: "Samsung", model: "Galaxy A54" });
  expect(parseDevice("black shark 5 Pro")).toEqual({ brand: "Black Shark", model: "5 Pro" });
  expect(parseDevice("custom brand model X", [{ brand: "Custom Brand", model: "Model X" }])).toEqual({ brand: "Custom Brand", model: "Model X" });
  expect(parseDevice("BrandBaru TipeBaru")).toEqual({ brand: "BrandBaru", model: "TipeBaru" });
});

test("multiple quick complaints and optional notes remain readable in the saved ticket", () => {
  expect(complaintText(["LCD pecah", "Kena air"], "  Jatuh kemarin  ")).toBe("LCD pecah, Kena air\nJatuh kemarin");
  expect(complaintText([], "Keluhan khusus")).toBe("Keluhan khusus");
  expect(complaintText([], "  ")).toBe("");
});
