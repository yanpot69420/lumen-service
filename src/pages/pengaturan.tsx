import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Plus, Upload, UserX, KeyRound } from "lucide-react";
import { db, uid } from "@/db/db";
import type { Role, TicketStatus, User } from "@/db/types";
import { TICKET_STATUSES } from "@/db/types";
import { getSetting, getWaTemplates, setSetting } from "@/db/settings";
import { hashPin, newSalt } from "@/auth/pin";
import { usernameSlug, USERNAME_RE } from "@/lib/username";
import {
  encryptBackup,
  decryptBackup,
  blobToDataUrl,
  dataUrlToBlob,
} from "@/lib/backup";
import { logAudit } from "@/db/audit";
import { useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { PageBody, PageHeader, ROLE_LABEL } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TICKET_STATUS_LABEL } from "@/components/ui/status-tag";
import { useToast } from "@/components/ui/toast";

export function PengaturanPage() {
  const user = useUser();
  const isOwner = user.role === "owner";
  return (
    <>
      <PageHeader title="Pengaturan" />
      <PageBody>
        <StoreSection />
        {isOwner && <UsersSection />}
        <WaSection />
        {canSeeMoney(user.role) && <BackupSection />}
        <p className="pb-4 text-center text-xs text-slate-300">
          Lumen Service v0.1 — data tersimpan di perangkat ini.
        </p>
      </PageBody>
    </>
  );
}

function StoreSection() {
  const toast = useToast();
  const [f, setF] = useState({
    storeName: "",
    storeTagline: "",
    storeAddress: "",
    storePhone: "",
    storeHours: "",
    notaFooter: "",
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setF({
        storeName: await getSetting("storeName"),
        storeTagline: await getSetting("storeTagline"),
        storeAddress: await getSetting("storeAddress"),
        storePhone: await getSetting("storePhone"),
        storeHours: await getSetting("storeHours"),
        notaFooter: await getSetting("notaFooter"),
      });
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profil Toko</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Nama toko">
          <Input value={f.storeName} onChange={(e) => setF({ ...f, storeName: e.target.value })} />
        </Field>
        <Field label="Tagline (web publik)">
          <Input value={f.storeTagline} onChange={(e) => setF({ ...f, storeTagline: e.target.value })} />
        </Field>
        <Field label="Alamat">
          <Textarea value={f.storeAddress} onChange={(e) => setF({ ...f, storeAddress: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="No. WA toko">
            <Input inputMode="tel" value={f.storePhone} onChange={(e) => setF({ ...f, storePhone: e.target.value })} />
          </Field>
          <Field label="Jam buka">
            <Input value={f.storeHours} onChange={(e) => setF({ ...f, storeHours: e.target.value })} />
          </Field>
        </div>
        <Field label="Catatan kaki nota">
          <Input value={f.notaFooter} onChange={(e) => setF({ ...f, notaFooter: e.target.value })} />
        </Field>
        <Button
          onClick={async () => {
            for (const [k, v] of Object.entries(f)) await setSetting(k, v.trim());
            toast("Profil toko disimpan");
          }}
        >
          Simpan
        </Button>
      </CardContent>
    </Card>
  );
}

function UsersSection() {
  const me = useUser();
  const toast = useToast();
  const users = useLiveQuery(() => db.users.toArray(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<User | null>(null);
  const [deactTarget, setDeactTarget] = useState<User | null>(null);
  const [f, setF] = useState({
    name: "",
    username: "",
    usernameTouched: false,
    role: "kasir" as Role,
    pin: "",
  });
  const [newPin, setNewPin] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pengguna</CardTitle>
        <Button variant="secondary" size="sm" onClick={() => {
          setF({ name: "", username: "", usernameTouched: false, role: "kasir", pin: "" });
          setFormOpen(true);
        }}>
          <Plus /> Tambah
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {users?.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-brand-950 text-xs font-bold text-white">
              {u.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {u.name}
                {u.active === 0 && (
                  <span className="ml-2 text-xs font-normal text-red-500">nonaktif</span>
                )}
              </p>
              <p className="text-xs text-slate-400">
                @{u.username} · {ROLE_LABEL[u.role]}
              </p>
            </div>
            <button
              onClick={() => {
                setNewPin("");
                setPinTarget(u);
              }}
              className="text-slate-300 hover:text-brand-500"
              aria-label="Reset PIN"
            >
              <KeyRound className="size-4" />
            </button>
            {u.id !== me.id && u.active === 1 && (
              <button
                onClick={() => setDeactTarget(u)}
                className="text-slate-300 hover:text-red-500"
                aria-label="Nonaktifkan"
              >
                <UserX className="size-4" />
              </button>
            )}
          </div>
        ))}
        <p className="text-xs text-slate-400">
          Kasir & Teknisi: akses operasional tanpa harga modal/laba — aktifkan saat merekrut karyawan.
        </p>
      </CardContent>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} title="Tambah Pengguna">
        <div className="space-y-4">
          <Field label="Nama" required>
            <Input
              value={f.name}
              onChange={(e) =>
                setF({
                  ...f,
                  name: e.target.value,
                  username: f.usernameTouched
                    ? f.username
                    : usernameSlug(e.target.value),
                })
              }
            />
          </Field>
          <Field label="Username" required hint="Huruf kecil/angka/titik — dipakai untuk login.">
            <Input
              autoCapitalize="none"
              value={f.username}
              onChange={(e) =>
                setF({
                  ...f,
                  usernameTouched: true,
                  username: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9._]/g, "")
                    .slice(0, 20),
                })
              }
            />
          </Field>
          <Field label="Peran">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="kasir">Kasir</option>
              <option value="teknisi">Teknisi</option>
              <option value="headops">Head Operasional</option>
            </Select>
          </Field>
          <Field label="PIN (4–6 digit)" required>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={f.pin}
              onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })}
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={
              !f.name.trim() ||
              !USERNAME_RE.test(f.username) ||
              !/^\d{4,6}$/.test(f.pin)
            }
            onClick={async () => {
              const dupe = await db.users
                .where("username")
                .equals(f.username)
                .count();
              if (dupe > 0) {
                toast(`Username "${f.username}" sudah dipakai`, "error");
                return;
              }
              const salt = newSalt();
              const id = uid();
              await db.users.add({
                id,
                name: f.name.trim(),
                username: f.username,
                role: f.role,
                pinHash: await hashPin(f.pin, salt),
                pinVer: 2,
                salt,
                active: 1,
                createdAt: Date.now(),
              });
              await logAudit(me, "buat", "pengguna", id, `Pengguna baru: ${f.name.trim()} (${ROLE_LABEL[f.role]})`);
              toast("Pengguna ditambahkan");
              setFormOpen(false);
            }}
          >
            Simpan
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!pinTarget} onClose={() => setPinTarget(null)} title={`Reset PIN — ${pinTarget?.name}`}>
        <div className="space-y-4">
          <Field label="PIN baru (4–6 digit)" required>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={!/^\d{4,6}$/.test(newPin)}
            onClick={async () => {
              if (!pinTarget) return;
              const salt = newSalt();
              await db.users.update(pinTarget.id, {
                salt,
                pinHash: await hashPin(newPin, salt),
                pinVer: 2,
              });
              await logAudit(me, "pin", "pengguna", pinTarget.id, `Reset PIN ${pinTarget.name}`);
              toast("PIN direset");
              setPinTarget(null);
            }}
          >
            Reset PIN
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!deactTarget}
        title={`Nonaktifkan ${deactTarget?.name}?`}
        confirmLabel="Nonaktifkan"
        destructive
        onCancel={() => setDeactTarget(null)}
        onConfirm={async () => {
          if (!deactTarget) return;
          await db.users.update(deactTarget.id, { active: 0 });
          await logAudit(me, "nonaktif", "pengguna", deactTarget.id, `Nonaktifkan ${deactTarget.name}`);
          toast("Pengguna dinonaktifkan");
          setDeactTarget(null);
        }}
      >
        Pengguna tidak bisa login lagi, tapi riwayat aktivitasnya tetap tersimpan.
      </ConfirmDialog>
    </Card>
  );
}

function WaSection() {
  const toast = useToast();
  const [tpls, setTpls] = useState<Record<TicketStatus, string> | null>(null);

  useEffect(() => {
    getWaTemplates().then(setTpls);
  }, []);

  if (!tpls) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Template Pesan WA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-400">
          Placeholder: {"{nama} {nota} {tipe} {keluhan} {estimasi} {toko}"}
        </p>
        {TICKET_STATUSES.map((s) => (
          <Field key={s} label={`Status: ${TICKET_STATUS_LABEL[s]}`}>
            <Textarea
              value={tpls[s]}
              onChange={(e) => setTpls({ ...tpls, [s]: e.target.value })}
            />
          </Field>
        ))}
        <Button
          onClick={async () => {
            await setSetting("waTemplates", JSON.stringify(tpls));
            toast("Template disimpan");
          }}
        >
          Simpan Template
        </Button>
      </CardContent>
    </Card>
  );
}

function BackupSection() {
  const user = useUser();
  const toast = useToast();
  const [includePhotos, setIncludePhotos] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importEnc, setImportEnc] = useState(false);
  const [importPass, setImportPass] = useState("");
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const lastBackup = useLiveQuery(async () => {
    const row = await db.settings.get("lastBackupAt");
    return row ? Number(row.value) : 0;
  }, []);

  useEffect(() => {
    navigator.storage
      ?.persisted?.()
      .then(setPersisted)
      .catch(() => setPersisted(null));
  }, []);

  async function doExport() {
    setBusy(true);
    try {
      const photos = includePhotos
        ? await Promise.all(
            (await db.photos.toArray()).map(async (p) => ({
              id: p.id,
              refType: p.refType,
              refId: p.refId,
              createdAt: p.createdAt,
              dataUrl: await blobToDataUrl(p.blob),
            })),
          )
        : [];
      const payload = {
        app: "lumen-service",
        version: 2,
        exportedAt: new Date().toISOString(),
        users: await db.users.toArray(),
        settings: await db.settings.toArray(),
        tickets: await db.tickets.toArray(),
        units: await db.units.toArray(),
        parts: await db.parts.toArray(),
        cash: await db.cash.toArray(),
        dayCloses: await db.dayCloses.toArray(),
        corrections: await db.corrections.toArray(),
        audit: await db.audit.toArray(),
        photos,
      };
      const json = JSON.stringify(payload);
      const out = passphrase.trim()
        ? JSON.stringify(await encryptBackup(json, passphrase.trim()))
        : json;
      const blob = new Blob([out], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lumen-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      await setSetting("lastBackupAt", String(Date.now()));
      await logAudit(
        user,
        "backup",
        "sistem",
        "-",
        `Export backup (${includePhotos ? "dengan" : "tanpa"} foto, ${passphrase.trim() ? "terenkripsi" : "tanpa enkripsi"})`,
      );
      toast("Backup terunduh");
    } finally {
      setBusy(false);
    }
  }

  async function onPickImport(file: File | null) {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (raw.app !== "lumen-service") throw new Error("File bukan backup Lumen");
      setImportEnc(raw.enc === 1);
      setImportPass("");
      setImportFile(file);
    } catch (e) {
      toast(e instanceof Error ? e.message : "File tidak valid", "error");
    }
  }

  async function doImport() {
    if (!importFile) return;
    setBusy(true);
    try {
      let raw = JSON.parse(await importFile.text());
      if (raw.enc === 1) {
        try {
          raw = JSON.parse(await decryptBackup(raw, importPass));
        } catch {
          throw new Error("Passphrase salah");
        }
      }
      // Normalisasi backup versi lama: user tanpa username tetap bisa login.
      const taken = new Set<string>();
      const users = (raw.users ?? []).map(
        (u: { name: string; username?: string }) => {
          let uname = u.username || usernameSlug(u.name) || "user";
          let i = 1;
          const base = uname;
          while (taken.has(uname)) uname = `${base}${++i}`;
          taken.add(uname);
          return { ...u, username: uname };
        },
      );
      const photoRows = await Promise.all(
        ((raw.photos ?? []) as {
          id: string;
          refType: string;
          refId: string;
          createdAt: number;
          dataUrl: string;
        }[]).map(async (p) => ({
          id: p.id,
          refType: p.refType as "ticket" | "unit" | "unit-ktp",
          refId: p.refId,
          createdAt: p.createdAt,
          blob: await dataUrlToBlob(p.dataUrl),
        })),
      );
      await db.transaction(
        "rw",
        [db.users, db.settings, db.tickets, db.units, db.parts, db.cash, db.dayCloses, db.corrections, db.audit, db.photos],
        async () => {
          await Promise.all([
            db.users.clear(), db.settings.clear(), db.tickets.clear(),
            db.units.clear(), db.parts.clear(), db.cash.clear(),
            db.dayCloses.clear(), db.corrections.clear(), db.audit.clear(),
            db.photos.clear(),
          ]);
          await db.users.bulkAdd(users);
          await db.settings.bulkAdd(raw.settings ?? []);
          await db.tickets.bulkAdd(raw.tickets ?? []);
          await db.units.bulkAdd(raw.units ?? []);
          await db.parts.bulkAdd(raw.parts ?? []);
          await db.cash.bulkAdd(raw.cash ?? []);
          await db.dayCloses.bulkAdd(raw.dayCloses ?? []);
          await db.corrections.bulkAdd(raw.corrections ?? []);
          await db.audit.bulkAdd(raw.audit ?? []);
          await db.photos.bulkAdd(photoRows);
        },
      );
      toast(
        photoRows.length > 0
          ? "Data & foto berhasil dipulihkan"
          : "Data dipulihkan (backup ini tidak berisi foto)",
      );
      setImportFile(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Gagal import", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup Data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          <p>
            Backup terakhir:{" "}
            <b>
              {lastBackup
                ? new Date(lastBackup).toLocaleString("id-ID")
                : "BELUM PERNAH"}
            </b>
          </p>
          <p className="mt-1">
            Proteksi penyimpanan browser:{" "}
            {persisted === null
              ? "tidak diketahui"
              : persisted
                ? "aktif ✔"
                : "belum aktif — jangan hapus data browser"}
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Data hanya tersimpan di perangkat ini. Unduh backup rutin (idealnya
          tiap tutup kas) dan simpan ke penyimpanan pribadi seperti Google
          Drive. Jangan kirim lewat chat.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includePhotos}
            onChange={(e) => setIncludePhotos(e.target.checked)}
            className="size-4 rounded"
          />
          Sertakan foto (file lebih besar, bukti lengkap)
        </label>
        <Field
          label="Passphrase enkripsi (opsional, disarankan)"
          hint="Backup berisi data pelanggan & keuangan. Tanpa passphrase file bisa dibaca siapa pun."
        >
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="kosongkan = tanpa enkripsi"
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={doExport}>
            <Download /> Unduh Backup
          </Button>
          <label className="flex-1">
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                onPickImport(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50 [&_svg]:size-4">
              <Upload /> Pulihkan Backup
            </span>
          </label>
        </div>
      </CardContent>
      <ConfirmDialog
        open={!!importFile}
        title="Pulihkan dari backup?"
        confirmLabel="Ya, timpa data"
        destructive
        busy={busy}
        onCancel={() => setImportFile(null)}
        onConfirm={doImport}
      >
        <div className="space-y-3">
          <p>
            Semua data di perangkat ini akan DIGANTI dengan isi file{" "}
            <b>{importFile?.name}</b>. Pastikan file benar.
          </p>
          {importEnc && (
            <Field label="Passphrase backup" required>
              <Input
                type="password"
                value={importPass}
                onChange={(e) => setImportPass(e.target.value)}
              />
            </Field>
          )}
        </div>
      </ConfirmDialog>
    </Card>
  );
}
