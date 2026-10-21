import { hashPin, newSalt } from "@/auth/pin";
import { useSession } from "@/auth/session";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { logAudit } from "@/db/audit";
import { cloudLogin, cloudRecover, isCloud, offlineLogin } from "@/db/cloud";
import { db } from "@/db/db";
import { ArrowRight, ClipboardList, Package, Users } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

/** Terima input kode dengan/tanpa strip, huruf kecil, spasi. */
function normalizeRecoveryCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const parts = [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)];
  return parts.filter(Boolean).join("-");
}

export function LoginPage() {
  const { user, login, adopt, hasUsers, ready } = useSession();
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
      if (isCloud && !navigator.onLine) {
        const id = await offlineLogin(username, pin);
        if (!id) { toast("Akses offline hanya untuk staf terakhir yang login online dalam 24 jam. Sambungkan internet untuk akun lain.", "error"); return; }
        adopt(id); nav("/app/beranda", { replace: true }); return;
      }
      if (isCloud) {
        // Verifikasi PIN di server → sesi cloud + tarik users ke cache lokal.
        const r = await cloudLogin(username, pin);
        if (!r.ok) {
          toast(r.error ?? "Username atau PIN salah", "error");
          setPin("");
          return;
        }
        // Server sudah memverifikasi — set sesi langsung tanpa hash PIN ulang.
        if (r.userId) {
          adopt(r.userId);
          nav("/app/beranda", { replace: true });
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
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-5 lg:p-8">
      <div className="mx-auto grid w-full max-w-[1120px] gap-8 lg:min-h-[650px] lg:grid-cols-[1.1fr_1fr]">
        <section className="hidden flex-col rounded-[32px] bg-brand-950 p-10 text-white lg:flex xl:p-12" aria-label="Lumen Service">
          <div className="flex items-center gap-3"><BrandMark /><p className="text-lg font-semibold tracking-tight">Lumen <span className="font-normal text-white/70">Service</span></p></div>
          <div className="my-auto py-12">
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-accent-400">Ruang kerja toko Anda</p>
            <h2 className="mt-5 text-[42px] font-semibold leading-[1.15] tracking-[-.05em]">Lebih teratur.<br /><span className="text-accent-400">Lebih mudah dilayani.</span></h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-white/55">Kelola pekerjaan servis, kenali pelanggan, dan pantau kebutuhan toko dalam satu tempat.</p>
            <div className="mt-9 space-y-3">
              {[
                { Icon: ClipboardList, title: "Nota servis", hint: "Dari penerimaan sampai pengambilan" },
                { Icon: Users, title: "Pelanggan", hint: "Kontak, langganan, dan riwayat servis" },
                { Icon: Package, title: "Stok & kas", hint: "Barang dan pencatatan toko yang terhubung" },
              ].map(({ Icon, title, hint }) => <div key={title} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.04] p-3.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[.06] text-accent-400"><Icon className="size-[18px]" /></span><div><p className="text-[13px] font-semibold">{title}</p><p className="mt-1 text-[11px] text-white/45">{hint}</p></div></div>)}
            </div>
          </div>
          <p className="text-[10px] text-white/35">Lumen Service · Sistem operasional konter</p>
        </section>
        <div className="flex items-center justify-center py-6 lg:py-10">
        <div className="w-full max-w-[390px]">
          <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden"><BrandMark /><p className="text-lg font-semibold tracking-tight text-brand-950">Lumen <span className="font-normal">Service</span></p></div>
          <p className="text-[10px] font-semibold uppercase tracking-[.17em] text-brand-600">Akun staf</p>
          <h1 className="mt-3 text-[29px] font-semibold tracking-[-.045em] text-brand-950">Masuk ke ruang kerja</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">Selamat datang kembali. Gunakan akun toko Anda untuk melanjutkan.</p>
      <div className="mt-8 space-y-5 rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_-20px_rgba(0,0,0,.2)]">
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
          {busy ? "Memeriksa akun…" : <>Masuk <ArrowRight className="size-4" /></>}
        </Button>
        <button
          onClick={() => {
            setRUser(username);
            setRCode("");
            setRPin("");
            setRecoverOpen(true);
          }}
          className="min-h-10 w-full text-center text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-brand-700"
        >
          Lupa PIN? Pakai kode pemulihan
        </button>
      </div>
      <p className="mt-5 text-center text-[11px] leading-relaxed text-slate-400">Akses mengikuti peran akun yang terdaftar di toko.</p>
        </div>
        </div>
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
                if (isCloud) {
                  await cloudRecover(rUser, rCode, rPin);
                  toast("PIN cloud berhasil dipulihkan. Masuk dengan PIN baru."); setRecoverOpen(false); return;
                }
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
