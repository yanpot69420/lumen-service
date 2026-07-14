import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/db/db";
import type { User } from "@/db/types";
import { hashPin, newSalt, newRecoveryCode } from "@/auth/pin";
import { setSetting } from "@/db/settings";
import { cloudSetup, isCloud } from "@/db/cloud";
import { usernameSlug, USERNAME_RE } from "@/lib/username";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function SetupPage() {
  const nav = useNavigate();
  const toast = useToast();
  const userCount = useLiveQuery(() => db.users.count(), []);
  const [storeName, setStoreName] = useState("Lumen Service");
  const [storePhone, setStorePhone] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [ownerUserTouched, setOwnerUserTouched] = useState(false);
  const [ownerPin, setOwnerPin] = useState("");
  const [opsName, setOpsName] = useState("");
  const [opsUsername, setOpsUsername] = useState("");
  const [opsUserTouched, setOpsUserTouched] = useState(false);
  const [opsPin, setOpsPin] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (userCount === undefined) return null;
  if (userCount > 0 && !busy && !recoveryCode)
    return <Navigate to="/app/login" replace />;

  // Layar terakhir: kode pemulihan PIN owner — tampil sekali saja.
  if (recoveryCode) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-100 text-2xl">
          🔑
        </div>
        <div>
          <h1 className="text-xl font-bold">Simpan Kode Pemulihan PIN</h1>
          <p className="mt-1 text-sm text-slate-500">
            Satu-satunya cara masuk bila Owner lupa PIN. Catat di tempat aman di
            luar HP ini — kode hanya ditampilkan SEKALI.
          </p>
        </div>
        <p className="rounded-2xl border-2 border-dashed border-brand-300 bg-white py-5 font-mono text-2xl font-bold tracking-wider">
          {recoveryCode}
        </p>
        <Button size="lg" onClick={() => nav("/app/login", { replace: true })}>
          Sudah Saya Catat — Lanjut Login
        </Button>
      </div>
    );
  }

  const valid =
    storeName.trim() &&
    ownerName.trim() &&
    USERNAME_RE.test(ownerUsername) &&
    /^\d{4,6}$/.test(ownerPin) &&
    opsName.trim() &&
    USERNAME_RE.test(opsUsername) &&
    opsUsername !== ownerUsername &&
    /^\d{4,6}$/.test(opsPin);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // Mode cloud: server (Edge Function) yang membuat user + kode pemulihan,
      // lalu data ditarik ke cache lokal. PIN tak pernah dikirim polos ke DB.
      if (isCloud) {
        const r = await cloudSetup({
          store: { name: storeName.trim(), phone: storePhone.trim() },
          owner: { name: ownerName.trim(), username: ownerUsername, pin: ownerPin },
          headops: { name: opsName.trim(), username: opsUsername, pin: opsPin },
        });
        if (!r.ok) {
          toast(r.error ?? "Setup gagal", "error");
          return;
        }
        toast("Setup selesai");
        setRecoveryCode(r.recoveryCode ?? "—");
        return;
      }

      const now = Date.now();
      const mkUser = async (
        name: string,
        username: string,
        role: "owner" | "headops",
        pin: string,
      ): Promise<User> => {
        const salt = newSalt();
        return {
          id: uid(),
          name: name.trim(),
          username,
          role,
          pinHash: await hashPin(pin, salt),
          pinVer: 2 as const,
          salt,
          active: 1 as const,
          createdAt: now,
        };
      };
      const owner = await mkUser(ownerName, ownerUsername, "owner", ownerPin);
      const ops = await mkUser(opsName, opsUsername, "headops", opsPin);
      const code = newRecoveryCode();
      const recoverySalt = newSalt();
      owner.recoveryHash = await hashPin(code, recoverySalt);
      owner.recoverySalt = recoverySalt;
      await db.users.bulkAdd([owner, ops]);
      await setSetting("storeName", storeName.trim());
      await setSetting("storePhone", storePhone.trim());
      await db.audit.add({
        id: uid(),
        at: now,
        userId: owner.id,
        userName: owner.name,
        action: "setup",
        entity: "sistem",
        entityId: "-",
        summary: `Setup awal: toko "${storeName.trim()}", 2 pengguna dibuat`,
      });
      toast("Setup selesai");
      setRecoveryCode(code);
    } finally {
      setBusy(false);
    }
  }

  const cleanUsername = (v: string) =>
    v.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 20);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-950 text-2xl font-black text-accent-500">
          L
        </div>
        <h1 className="text-xl font-bold">Selamat datang di Lumen</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setup sekali di awal — buat akun Owner dan Head Operasional.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <Field label="Nama toko" required>
          <Input value={storeName} onChange={(e) => setStoreName(e.target.value)} />
        </Field>
        <Field label="No. WA toko" hint="Dipakai di web publik & nota">
          <Input
            inputMode="tel"
            placeholder="08xxxxxxxxxx"
            value={storePhone}
            onChange={(e) => setStorePhone(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold">Akun Owner (pemodal)</p>
        <Field label="Nama" required>
          <Input
            value={ownerName}
            onChange={(e) => {
              setOwnerName(e.target.value);
              if (!ownerUserTouched)
                setOwnerUsername(usernameSlug(e.target.value));
            }}
          />
        </Field>
        <Field label="Username" required hint="Huruf kecil/angka/titik, min. 3 karakter — dipakai untuk login.">
          <Input
            autoCapitalize="none"
            value={ownerUsername}
            onChange={(e) => {
              setOwnerUserTouched(true);
              setOwnerUsername(cleanUsername(e.target.value));
            }}
          />
        </Field>
        <Field label="PIN (4–6 digit)" required>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={ownerPin}
            onChange={(e) => setOwnerPin(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold">Akun Head Operasional</p>
        <Field label="Nama" required>
          <Input
            value={opsName}
            onChange={(e) => {
              setOpsName(e.target.value);
              if (!opsUserTouched) setOpsUsername(usernameSlug(e.target.value));
            }}
          />
        </Field>
        <Field label="Username" required>
          <Input
            autoCapitalize="none"
            value={opsUsername}
            onChange={(e) => {
              setOpsUserTouched(true);
              setOpsUsername(cleanUsername(e.target.value));
            }}
          />
        </Field>
        <Field label="PIN (4–6 digit)" required>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={opsPin}
            onChange={(e) => setOpsPin(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>

      <Button size="lg" disabled={!valid || busy} onClick={submit}>
        Mulai Pakai Lumen
      </Button>
    </div>
  );
}
