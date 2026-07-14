import Dexie, { type Table } from "dexie";
import { usernameSlug } from "@/lib/username";
import type {
  AuditEntry,
  CashEntry,
  Correction,
  DayClose,
  Part,
  Photo,
  Setting,
  Ticket,
  Unit,
  User,
} from "./types";

export class LumenDB extends Dexie {
  users!: Table<User, string>;
  settings!: Table<Setting, string>;
  tickets!: Table<Ticket, string>;
  photos!: Table<Photo, string>;
  units!: Table<Unit, string>;
  parts!: Table<Part, string>;
  cash!: Table<CashEntry, string>;
  dayCloses!: Table<DayClose, string>;
  corrections!: Table<Correction, string>;
  audit!: Table<AuditEntry, string>;

  constructor() {
    super("lumen-service");
    this.version(1).stores({
      users: "id, role, active",
      settings: "key",
      tickets: "id, &noNota, status, createdAt, phone",
      photos: "id, [refType+refId]",
      units: "id, &kode, imei, status, boughtAt, soldAt",
      parts: "id, nama, kategori",
      cash: "id, dayKey, at, category, refId",
      dayCloses: "dayKey, closedAt",
      corrections: "id, status, at",
      audit: "id, at, userId, entity",
    });
    // v2: login pakai username (akun lama diisi otomatis dari nama).
    this.version(2)
      .stores({ users: "id, &username, role, active" })
      .upgrade(async (tx) => {
        const users = await tx.table("users").toArray();
        const taken = new Set<string>();
        for (const u of users) {
          const base = usernameSlug(u.name) || "user";
          let uname = base;
          let i = 1;
          while (taken.has(uname)) uname = `${base}${++i}`;
          taken.add(uname);
          await tx.table("users").update(u.id, { username: uname });
        }
      });
  }
}

export const db = new LumenDB();

export const uid = () => crypto.randomUUID();
