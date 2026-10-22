import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { db } from "@/db/db";
import { isCloud } from "@/db/supabase";
import { syncNow, useSyncStatus } from "@/db/sync";
import { batchActor, planSyncQueue } from "@/db/sync-queue";
import { fmtDateTime } from "@/lib/format";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Cloud, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

export function SinkronisasiPage() {
  const user = useUser();
  const status = useSyncStatus();
  const queue = useLiveQuery(async () => {
    const [entries, users] = await Promise.all([db.outbox.orderBy("seq").toArray(), db.users.toArray()]);
    const names = new Map(users.map((staff) => [staff.id, staff.name]));
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = entry.batchId ?? `legacy:${entry.seq}`;
      const rows = groups.get(key) ?? [];
      rows.push(entry); groups.set(key, rows);
    }
    const plan = planSyncQueue(entries, user.id, names);
    return { plan, transactions: [...groups.entries()].map(([id, rows]) => {
      const actor = batchActor(rows);
      const tables = new Set(rows.map((row) => row.table));
      const title = tables.has("dayCloses") ? "Penutupan kas" : tables.has("corrections") ? "Koreksi transaksi" : tables.has("tickets") ? "Pencatatan servis" : tables.has("units") ? "Pencatatan unit HP" : tables.has("parts") ? "Pencatatan stok" : tables.has("cash") ? "Pencatatan kas" : tables.has("photos") ? "Penyimpanan foto" : "Perubahan data toko";
      return { id, actor, name: actor ? names.get(actor) ?? "Staf sebelumnya" : "Akun belum teridentifikasi", at: rows[0].at, title };
    }) };
  }, [user.id, user.role]);
  if (!isCloud) return <><PageHeader title="Sinkronisasi" /><PageBody><p className="rounded-2xl bg-white p-5 text-sm">Aplikasi memakai penyimpanan lokal. Unduh backup berkala di <Link className="underline" to="/app/pengaturan">Pengaturan</Link>.</p></PageBody></>;
  return <>
    <PageHeader title="Pusat Sinkronisasi" subtitle="Periksa perubahan yang belum terkirim dari perangkat ini." />
    <PageBody>
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm font-semibold">{queue === undefined ? "Memuat antrean…" : `${queue.transactions.length} transaksi belum terkirim`}</p><p className="mt-1 text-xs text-slate-500">Terakhir berhasil diperbarui: {status.lastSync ? fmtDateTime(status.lastSync) : "belum ada pada sesi ini"}</p></div><Button disabled={status.state === "syncing"} onClick={() => { void syncNow(); }}><RefreshCw className={status.state === "syncing" ? "animate-spin" : ""} />{status.state === "syncing" ? "Menyinkronkan…" : "Coba sinkronkan"}</Button></div>
        <p className="text-sm leading-relaxed text-slate-600">Perubahan yang belum terkirim tetap tersimpan di perangkat ini. Jangan mengisi ulang transaksi yang sama atau menghapus data browser untuk membersihkan antrean.</p>
        {status.state === "offline" && <p role="status" className="text-sm text-accent-800">Perangkat sedang offline. Sambungkan internet untuk melanjutkan pengiriman.</p>}
        {status.error && <p role="alert" className="rounded-xl bg-accent-50 p-3 text-sm text-accent-900 [overflow-wrap:anywhere]">{status.error}</p>}
        <Link className="inline-flex min-h-11 items-center text-sm font-medium underline" to="/app/pengaturan">Simpan backup perangkat</Link>
      </section>
      {!!queue?.plan.blockedAccounts.length && <section className="space-y-3 rounded-2xl border border-accent-200 bg-accent-50 p-5"><h2 className="text-sm font-semibold">Antrean yang memerlukan perhatian</h2>{queue.plan.blockedAccounts.map((account, index) => <div key={`${account.userId}:${account.reason}:${index}`} className="text-sm [overflow-wrap:anywhere]"><p className="font-medium">{account.name} · {account.count} catatan</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{account.reason === "account" ? "Masuk kembali sebagai staf pembuat untuk mengirim perubahan ini." : account.reason === "dependency" ? "Menunggu transaksi sebelumnya yang berkaitan selesai dikirim." : "Akun pembuat belum dapat dipastikan. Simpan backup dan minta pemeriksaan administrator."}</p></div>)}</section>}
      {queue?.transactions.length === 0 && <EmptyState icon={<CheckCircle2 />} title={status.state === "idle" ? "Antrean sudah terkirim" : "Tidak ada transaksi tertunda"} hint={status.state === "error" ? "Pengambilan pembaruan server belum berhasil. Periksa pesan di atas." : "Data yang muncul di sini khusus perangkat ini."} />}
      {!!queue?.transactions.length && <section className="space-y-3" aria-label="Transaksi tertunda">{queue.transactions.map((transaction) => <div key={transaction.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4"><Cloud className="mt-1 size-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{transaction.title}</p><p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{transaction.name} · {fmtDateTime(transaction.at)}</p><p className="mt-2 text-xs text-slate-500">{transaction.actor === user.id ? "Disimpan oleh akun Anda" : "Memerlukan akun pembuat"}</p></div></div>)}</section>}
    </PageBody>
  </>;
}
