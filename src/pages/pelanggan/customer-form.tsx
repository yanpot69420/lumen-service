import { useUser } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { saveCustomer } from "@/db/customers";
import type { Customer } from "@/db/types";
import { useState, type FormEvent } from "react";

/** Remounted when opened so an unfinished edit never leaks into another profile. */
export function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const user = useUser();
  const toast = useToast();
  const [initialCustomer] = useState(customer);
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    notes: customer?.notes ?? "",
    isRegular: customer?.isRegular ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const saved = await saveCustomer(user, form, initialCustomer?.id, initialCustomer);
      toast(customer ? "Profil pelanggan diperbarui" : "Pelanggan ditambahkan");
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profil belum berhasil disimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={customer ? "Edit Pelanggan" : "Tambah Pelanggan"} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nama pelanggan" required>
          <Input
            required
            autoComplete="name"
            maxLength={120}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Nama pelanggan"
          />
        </Field>
        <Field label="Nomor WhatsApp" hint="Opsional. Membantu menemukan pelanggan dan riwayat servisnya.">
          <Input
            type="tel"
            autoComplete="tel"
            maxLength={40}
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="08… atau +62…"
          />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
          <input
            type="checkbox"
            checked={form.isRegular}
            onChange={(event) => setForm({ ...form, isRegular: event.target.checked })}
            className="mt-0.5 size-4 accent-accent-600"
          />
          <span>
            <span className="block text-sm font-medium">Pelanggan langganan</span>
            <span className="mt-0.5 block text-xs text-slate-500">Tandai pelanggan yang rutin datang ke toko.</span>
          </span>
        </label>
        <Field label="Catatan pelanggan" hint="Catatan internal untuk membantu pelayanan.">
          <Textarea
            rows={3}
            maxLength={2000}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="Contoh: hubungi lewat WA sebelum mengganti sparepart."
          />
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button type="submit" variant="accent" disabled={busy || !form.name.trim()}>
            {busy ? "Menyimpan…" : "Simpan Pelanggan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
