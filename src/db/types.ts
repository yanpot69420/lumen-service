export type Role = "owner" | "headops" | "kasir" | "teknisi";
export interface Versioned { _version?: number; }

export interface User extends Versioned {
  id: string;
  name: string;
  username: string; // lowercase, unik — dipakai untuk login
  role: Role;
  pinHash: string;
  pinVer?: 1 | 2; // 1 = SHA-256 lama, 2 = PBKDF2; di-upgrade otomatis saat login
  salt: string;
  recoveryHash?: string; // hash kode pemulihan PIN (sekali pakai)
  recoverySalt?: string;
  recoveryActive?: boolean;
  active: 1 | 0;
  createdAt: number;
}

export interface Setting extends Versioned {
  key: string;
  value: string;
}

export const TICKET_STATUSES = [
  "masuk",
  "dicek",
  "konfirmasi",
  "dikerjakan",
  "selesai",
  "diambil",
  "batal",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface StatusEvent {
  status: TicketStatus;
  at: number;
  by: string;
  note?: string;
}

export interface PartUsed {
  id?: string;
  partId: string;
  nama: string;
  qty: number;
  harga: number; // harga jual per pcs saat dipakai
  modal: number; // snapshot modal per pcs
}

export interface Ticket extends Versioned {
  id: string;
  customerId?: string;
  noNota: string;
  garansiDari?: string; // id tiket asal bila ini klaim garansi
  piutang?: number; // sisa belum dibayar saat unit sudah diambil
  customerName: string;
  phone: string;
  brand: string;
  model: string;
  keluhan: string;
  kelengkapan: string[];
  estimasi: number; // estimasi biaya awal
  biayaJasa: number; // harga final jasa (diisi saat konfirmasi)
  hargaFinal?: boolean;
  dp: number;
  status: TicketStatus;
  history: StatusEvent[];
  partsUsed: PartUsed[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface Customer extends Versioned {
  id: string;
  name: string;
  phone: string;
  phoneNormalized: string;
  notes: string;
  isRegular: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

export interface Photo extends Versioned {
  id: string;
  refType: "ticket" | "unit" | "unit-ktp" | "draft";
  refId: string;
  blob: Blob;
  remotePath?: string;
  createdAt: number;
}

export type UnitStatus = "stok" | "terjual";

export interface Unit extends Versioned {
  id: string;
  kode: string;
  brand: string;
  model: string;
  varian: string; // RAM/storage/warna
  imei: string;
  kondisi: string;
  hargaBeli: number;
  hargaJual: number; // 0 = belum ditentukan (tidak tampil di katalog)
  status: UnitStatus;
  sellerName: string;
  sellerPhone: string;
  garansiHari: number;
  boughtAt: number;
  soldAt?: number;
  soldPrice?: number;
  buyerName?: string;
  buyerPhone?: string;
  createdBy: string;
}

export interface Part extends Versioned {
  id: string;
  nama: string;
  brand?: string; // absent on older rows; UI can infer from an unambiguous name
  kategori: "sparepart" | "aksesoris";
  stok: number;
  hargaModal: number;
  hargaJual: number;
  minStok: number;
}

export type CashCategory =
  | "servis"
  | "jual_unit"
  | "retur_unit"
  | "jual_aksesoris"
  | "beli_unit"
  | "restok_part"
  | "operasional"
  | "prive"
  | "modal_masuk"
  | "lainnya";

export type CashMethod = "tunai" | "qris" | "transfer";

export interface CashEntry extends Versioned {
  id: string;
  at: number;
  dayKey: string; // YYYY-MM-DD
  type: "in" | "out";
  category: CashCategory;
  method?: CashMethod; // entri lama tanpa field ini = tunai
  amount: number;
  note: string;
  refType?: "ticket" | "unit" | "part";
  refId?: string;
  meta?: { modal?: number; qty?: number; paymentKind?: "dp" | "settlement" | "piutang" | "refund"; };
  by: string;
  byName: string;
  locked: 1 | 0;
  voided: 1 | 0;
}

export interface DayClose extends Versioned {
  dayKey: string;
  expected: number;
  counted: number;
  selisih: number;
  note: string;
  closedBy: string;
  closedByName: string;
  closedAt: number;
}

export interface Correction extends Versioned {
  id: string;
  at: number;
  entity: "cash";
  entityId: string;
  reason: string;
  before: { amount: number; note: string; voided: 1 | 0; };
  after: { amount: number; note: string; voided: 1 | 0; };
  requestedBy: string;
  requestedByName: string;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: number;
}

export interface AuditEntry extends Versioned {
  id: string;
  at: number;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
}
