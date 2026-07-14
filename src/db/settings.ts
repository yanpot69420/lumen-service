import { db } from "./db";
import type { TicketStatus } from "./types";

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

export async function getWaTemplates(): Promise<Record<TicketStatus, string>> {
  try {
    const raw = await getSetting("waTemplates");
    return { ...DEFAULT_WA_TEMPLATES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_WA_TEMPLATES;
  }
}

/** Nomor nota berurutan: LS-YYMM-0001 (servis) / LU-0001 (unit). */
export async function nextNota(kind: "ticket" | "unit"): Promise<string> {
  return db.transaction("rw", db.settings, async () => {
    const key = kind === "ticket" ? "counterTicket" : "counterUnit";
    const n = Number((await db.settings.get(key))?.value ?? "0") + 1;
    await db.settings.put({ key, value: String(n) });
    if (kind === "unit") return `LU-${String(n).padStart(4, "0")}`;
    const d = new Date();
    const ym =
      String(d.getFullYear()).slice(2) +
      String(d.getMonth() + 1).padStart(2, "0");
    return `LS-${ym}-${String(n).padStart(4, "0")}`;
  });
}
