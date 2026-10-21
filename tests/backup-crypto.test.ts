import { expect, test } from "bun:test";
import { blobToDataUrl, dataUrlToBlob, decryptBackup, encryptBackup } from "../src/lib/backup";

test("encrypted backup preserves Indonesian text and uses fresh encryption for every export", async () => {
  const plain = JSON.stringify({ nama: "Pelanggan Uji", catatan: "Layar retak — ganti baterai 🔧", jumlah: 1234567 });
  const first = await encryptBackup(plain, "uji-pemulihan-aman");
  const second = await encryptBackup(plain, "uji-pemulihan-aman");
  expect(await decryptBackup(first, "uji-pemulihan-aman")).toBe(plain);
  expect(first.data).not.toContain("Pelanggan Uji");
  expect(first.salt).not.toBe(second.salt);
  expect(first.iv).not.toBe(second.iv);
  expect(first.data).not.toBe(second.data);
});

test("wrong passphrase or altered encrypted bytes cannot produce a usable backup", async () => {
  const encrypted = await encryptBackup('{"app":"lumen-service","data":"uji"}', "uji-passphrase");
  await expect(decryptBackup(encrypted, "passphrase-salah")).rejects.toThrow();
  const binary = atob(encrypted.data);
  const changed = btoa(String.fromCharCode(binary.charCodeAt(0) ^ 1) + binary.slice(1));
  await expect(decryptBackup({ ...encrypted, data: changed }, "uji-passphrase")).rejects.toThrow();
});

test("photo backup encoding preserves bytes across multiple base64 chunks", async () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
  const original = new Blob([bytes], { type: "image/jpeg" });
  const dataUrl = await blobToDataUrl(original);
  const restored = await dataUrlToBlob(dataUrl);
  expect(dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  expect(restored.type).toBe("image/jpeg");
  expect(new Uint8Array(await restored.arrayBuffer())).toEqual(bytes);
});
