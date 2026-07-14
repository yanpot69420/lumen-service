import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { DatabaseBackup, ChevronRight } from "lucide-react";
import { db } from "@/db/db";

const STALE_MS = 3 * 86_400_000; // 3 hari

/** Peringatan bila data ada tapi backup belum pernah/terlalu lama. */
export function BackupReminder({ hasData }: { hasData: boolean }) {
  const last = useLiveQuery(async () => {
    const row = await db.settings.get("lastBackupAt");
    return row ? Number(row.value) : 0;
  }, []);
  const anyRecord = useLiveQuery(
    async () => (await db.cash.count()) + (await db.tickets.count()),
    [],
  );

  if (last === undefined || anyRecord === undefined) return null;
  if (!hasData && anyRecord === 0) return null;
  if (last && Date.now() - last < STALE_MS) return null;

  const days = last ? Math.floor((Date.now() - last) / 86_400_000) : null;
  return (
    <Link
      to="/app/pengaturan"
      className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700"
    >
      <DatabaseBackup className="size-4 shrink-0" />
      {days === null
        ? "Data belum pernah di-backup — unduh backup sekarang. Data hanya tersimpan di perangkat ini."
        : `Backup terakhir ${days} hari lalu — unduh backup baru di Pengaturan.`}
      <ChevronRight className="ml-auto size-4 shrink-0" />
    </Link>
  );
}
