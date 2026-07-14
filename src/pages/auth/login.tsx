import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "@/auth/session";
import { db } from "@/db/db";
import { hashPin, newSalt } from "@/auth/pin";
import { logAudit } from "@/db/audit";
import { cloudLogin, isCloud } from "@/db/cloud";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";

/** Terima input kode dengan/tanpa strip, huruf kecil, spasi. */
function normalizeRecoveryCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const parts = [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)];
  return parts.filter(Boolean).join("-");
}

export function LoginPage() {
  const { user, login, hasUsers, ready } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [rUser, setRUser] = useState("");
  const [rCode, setRCode] = useState("");
  const [rPin, setRPin] = useState("");

  if (user) return <Navigate to="/app/beranda" replace />;
  // Mode lokal: tanpa user → ke setup. Mode cloud: cache lokal bisa kosong di
  // perangkat baru meski cloud sudah ada isinya, jadi jangan auto-redirect.
  if (ready && !hasUsers && !isCloud)
    return <Navigate to="/app/setup" replace />;

  const valid = username.trim().length >= 3 && pin.length >= 4;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (isCloud) {
        // Verifikasi PIN di server → sesi cloud + tarik users ke cache lokal.
        const r = await cloudLogin(username, pin);
        if (!r.ok) {
          toast(r.error ?? "Username atau PIN salah", "error");
          setPin("");
          return;
        }
      }
      const ok = await login(username, pin);
      if (ok) {
        nav("/app/beranda", { replace: true });
      } else {
        toast("Username atau PIN salah", "error");
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-brand-950 text-2xl font-black text-accent-500">
          L
        </div>
        <h1 className="text-xl font-bold">Lumen Service</h1>
        <p className="mt-1 text-sm text-slate-500">Masuk ke sistem operasional</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <Field label="Username" required>
          <Input
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="username"
            value={username}
            onChange={(e) =>
              setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))
            }
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
        <Field label="PIN" required>
          <Input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="••••••"
            className="text-center text-lg tracking-[0.5em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
        <Button size="lg" className="w-full" disabled={!valid || busy} onClick={submit}>
          Masuk
        </Button>
        <button
          onClick={() => {
            setRUser(username);
            setRCode("");
            setRPin("");
            setRecoverOpen(true);
          }}
          className="w-full text-center text-xs font-medium text-slate-400 underline hover:text-brand-600"
        >
          Lupa PIN? Pakai kode pemulihan
        </button>
      </div>

      <Sheet
        open={recoverOpen}
        onClose={() => setRecoverOpen(false)}
        title="Pemulihan PIN"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Masukkan kode pemulihan yang dicatat saat setup (atau yang dibuat di
            Pengaturan). Kode hangus setelah dipakai.
          </p>
          <Field label="Username" required>
            <Input
              autoCapitalize="none"
              value={rUser}
              onChange={(e) =>
                setRUser(e.target.value.toLowerCase().replace(/\s/g, ""))
              }
            />
          </Field>
          <Field label="Kode pemulihan" required>
            <Input
              autoCapitalize="characters"
              placeholder="XXXX-XXXX-XXXX"
              className="font-mono uppercase"
              value={rCode}
              onChange={(e) => setRCode(normalizeRecoveryCode(e.target.value))}
            />
          </Field>
          <Field label="PIN baru (4–6 digit)" required>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={rPin}
              onChange={(e) => setRPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            disabled={
              busy || rUser.length < 3 || rCode.length < 14 || !/^\d{4,6}$/.test(rPin)
            }
            onClick={async () => {
              setBusy(true);
              try {
                const u = await db.users.where("username").equals(rUser).first();
                if (!u || !u.active || !u.recoveryHash || !u.recoverySalt) {
                  toast("Username atau kode pemulihan salah", "error");
                  return;
                }
                const hash = await hashPin(rCode, u.recoverySalt);
                if (hash !== u.recoveryHash) {
                  toast("Username atau kode pemulihan salah", "error");
                  return;
                }
                const salt = newSalt();
                await db.users.update(u.id, {
                  salt,
                  pinHash: await hashPin(rPin, salt),
                  pinVer: 2,
                  recoveryHash: undefined,
                  recoverySalt: undefined,
                });
                await logAudit(
                  u, "pulihkan-pin", "pengguna", u.id,
                  `PIN ${u.name} direset via kode pemulihan (kode hangus)`,
                );
                toast("PIN baru tersimpan. Buat kode pemulihan baru di Pengaturan.");
                setRecoverOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Reset PIN
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
