import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export function LoginPage() {
  const { user, login, hasUsers, ready } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app/beranda" replace />;
  if (ready && !hasUsers) return <Navigate to="/app/setup" replace />;

  const valid = username.trim().length >= 3 && pin.length >= 4;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await login(username, pin);
    setBusy(false);
    if (ok) {
      nav("/app/beranda", { replace: true });
    } else {
      toast("Username atau PIN salah", "error");
      setPin("");
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
      </div>
    </div>
  );
}
