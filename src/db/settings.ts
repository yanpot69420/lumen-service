import { logAudit } from "./audit";
import { db, isSharedSetting, uid } from "./db";
import { operation } from "./operations";
import type { TicketStatus, User } from "./types";

export const DEFAULT_WA_TEMPLATES: Record<TicketStatus, string> = {
  masuk:
    "Halo {nama}, unit {tipe} Anda sudah kami terima dengan nota {nota}. Keluhan: {keluhan}. Estimasi biaya {estimasi}. Simpan nomor nota untuk pengambilan ya 🙏",
  dicek:
    "Halo {nama}, unit {tipe} (nota {nota}) sedang kami periksa. Kami kabari hasilnya segera.",
  konfirmasi:
    "Halo {nama}, hasil pengecekan {tipe} (nota {nota}): biaya perbaikan {estimasi}. Mohon konfirmasi apakah dilanjutkan. Terima kasih.",
  dikerjakan:
    "Halo {nama}, unit {tipe} (nota {nota}) sedang dikerjakan. Kami kabari begitu selesai.",
  selesai:
    "Halo {nama}, kabar baik! Unit {tipe} (nota {nota}) sudah SELESAI dan siap diambil. Total biaya {estimasi}. Ditunggu kedatangannya 🙏",
  diambil:
    "Terima kasih {nama} sudah mempercayakan servis di {toko}. Simpan nota {nota} untuk klaim garansi. 🙏",
  batal:
    "Halo {nama}, servis {tipe} (nota {nota}) dibatalkan sesuai permintaan. Unit bisa diambil kembali di konter. Terima kasih.",
};

const DEFAULTS: Record<string, string> = {
  storeName: "Lumen Service",
  storeTagline: "Servis HP & Jual Beli HP Second",
  storeAddress: "",
  storePhone: "",
  storeHours: "Senin–Sabtu 09.00–21.00",
  notaFooter: "Terima kasih. Garansi servis 7 hari — simpan nota ini.",
  counterTicket: "0",
  counterUnit: "0",
  waTemplates: JSON.stringify(DEFAULT_WA_TEMPLATES),
};

export async function getSetting(key: string): Promise<string> {
  const row = await db.settings.get(key);
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function setSetting(key: string, value: string) {
  await db.settings.put({ key, value });
}
export async function saveStoreSettings(user: User, values: Record<string, string>) {
  return operation(user, "settings", async (actor) => {
    for (const [key, value] of Object.entries(values)) {
      if (!isSharedSetting(key) || value.length > 20000 || (key === "storeName" && !value.trim())) throw new Error("Pengaturan tidak valid");
      await db.settings.put({ key, value: value.trim() });
    }
    await logAudit(actor, "pengaturan", "sistem", "toko", `Ubah ${Object.keys(values).join(", ")}`);
  });
}

export async function getWaTemplates(): Promise<Record<TicketStatus, string>> {
  try {
    const raw = await getSetting("waTemplates");
    return { ...DEFAULT_WA_TEMPLATES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_WA_TEMPLATES;
  }
}

/** Servis: LS- + 12 karakter acak (60 bit), tetap aman dibuat saat offline. */
export async function nextNota(kind: "ticket" | "unit"): Promise<string> {
  if (kind === "ticket") {
    return db.transaction("rw", db.tickets, async () => {
      // Avoid visually ambiguous 0/O and 1/I; check existing local notes before use.
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      for (let attempt = 0; attempt < 5; attempt++) {
        const random = crypto.getRandomValues(new Uint8Array(12));
        const code = `LS-${Array.from(random, (n) => alphabet[n & 31]).join("")}`;
        if (!await db.tickets.where("noNota").equals(code).count()) return code;
      }
      throw new Error("Gagal membuat kode servis unik. Silakan coba lagi.");
    });
  }
  return db.transaction("rw", db.settings, async () => {
    const key = "counterUnit";
    const n = Number((await db.settings.get(key))?.value ?? "0") + 1;
    await db.settings.put({ key, value: String(n) });
    let device = (await db.settings.get("deviceId"))?.value;
    if (!device) { device = uid().replaceAll("-", "").slice(0, 12).toUpperCase(); await db.settings.put({ key: "deviceId", value: device }); }
    return `LU-${device}-${String(n).padStart(4, "0")}`;
  });
}
