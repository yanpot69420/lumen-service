import { canSeeMoney } from "@/auth/roles";
import { useUser } from "@/auth/session";
import { useToast } from "@/components/ui/toast";
import { useServiceAction } from "@/components/use-service-action";
import { db } from "@/db/db";
import { addPhoto, deletePhoto } from "@/db/photos";
import type { Photo } from "@/db/types";
import { cn } from "@/lib/cn";
import { compressImage } from "@/lib/image";
import { createPendingPhotoBatch } from "@/lib/pending-photo-batch";
import { useDialog } from "@/components/ui/use-dialog";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function FullPhoto({ url, onClose }: { url: string; onClose: () => void; }) {
  const ref = useDialog(true, onClose);
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal aria-label="Foto ukuran penuh" tabIndex={-1} className="relative flex max-h-full max-w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Tutup foto" onClick={onClose} className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-xl bg-slate-950/70 text-white"><X /></button>
        <img src={url} alt="Foto ukuran penuh" className="max-h-[calc(100dvh-2rem)] max-w-full rounded-lg object-contain" />
      </div>
    </div>, document.body,
  );
}

function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function PhotoThumb({
  photo,
  className,
  onDelete,
}: {
  photo: Photo;
  className?: string;
  onDelete?: () => void;
}) {
  const url = useObjectUrl(photo.blob);
  const [full, setFull] = useState(false);
  return (
    <>
      <div className={cn("relative", className)}>
        <button
          type="button"
          aria-label="Lihat foto ukuran penuh"
          onClick={() => setFull(true)}
          className="block h-full w-full"
        >
          {url && (
            <img
              src={url}
              alt="Foto"
              className="h-full w-full rounded-xl object-cover"
            />
          )}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Hapus foto"
            className="absolute right-1 top-1 rounded-lg bg-slate-950/60 p-1 text-white"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {full && url && <FullPhoto url={url} onClose={() => setFull(false)} />}
    </>
  );
}

/** Grid foto tersimpan untuk sebuah entitas + tombol tambah (kamera/galeri). */
export function PhotoManager({
  refType,
  refId,
  canDelete,
  label = "Tambah foto",
  onBusyChange,
  serviceUndo = false,
  disabled = false,
}: {
  refType: Photo["refType"];
  refId: string;
  canDelete?: boolean;
  label?: string;
  onBusyChange?: (busy: boolean) => void;
  serviceUndo?: boolean;
  disabled?: boolean;
}) {
  const photos = useLiveQuery(
    () => db.photos.where({ refType, refId }).toArray(),
    [refType, refId],
  );
  const user = useUser();
  const toast = useToast();
  const { run } = useServiceAction();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const picking = useRef(false);

  async function onPick(files: FileList | null) {
    if (!files?.length || picking.current || disabled) return;
    picking.current = true;
    setBusy(true);
    onBusyChange?.(true);
    let reportedByAction = false;
    try {
      const blobs: Blob[] = [];
      for (const f of Array.from(files)) {
        blobs.push(await compressImage(f));
      }
      const save = async () => {
        for (const blob of blobs) await addPhoto(user, refType, refId, blob);
      };
      if (serviceUndo) {
        reportedByAction = true;
        await run(save, { pending: "Menyimpan foto…", success: blobs.length > 1 ? `${blobs.length} foto ditambahkan` : "Foto ditambahkan" });
      }
      else await save();
    } catch (error) {
      if (!reportedByAction) toast(error instanceof Error ? error.message : "Gagal menyimpan foto", "error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      picking.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  async function removePhoto(id: string) {
    if (picking.current || disabled) return;
    picking.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      if (serviceUndo) await run(() => deletePhoto(user, id), { pending: "Menghapus foto…", success: "Foto dihapus" });
      else await deletePhoto(user, id);
    } catch (error) {
      if (!serviceUndo) toast(error instanceof Error ? error.message : "Gagal menghapus foto", "error");
    } finally {
      picking.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {photos?.map((p) => (
        <PhotoThumb
          key={p.id}
          photo={p}
          className="aspect-square"
          onDelete={!busy && !disabled && canDelete && (refType === "draft" || canSeeMoney(user.role)) ? () => { void removePhoto(p.id); } : undefined}
        />
      ))}
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-500"
      >
        <Camera className="size-5" />
        <span className="text-[10px]">{busy ? "Menyimpan…" : label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => onPick(e.target.files)}
      />
    </div>
  );
}

/** Ambil foto sementara sebelum entitas disimpan (dipakai form baru). */
export function PendingPhotos({
  blobs,
  onChange,
  label = "Tambah foto",
  onBusyChange,
  disabled = false,
}: {
  blobs: Blob[];
  onChange: (b: Blob[]) => void;
  label?: string;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const latest = useRef({ blobs, onChange, onBusyChange, toast });
  latest.current = { blobs, onChange, onBusyChange, toast };
  const batch = useRef<ReturnType<typeof createPendingPhotoBatch> | null>(null);
  if (!batch.current) batch.current = createPendingPhotoBatch({
    compress: compressImage,
    append: (added) => {
      const next = [...latest.current.blobs, ...added];
      latest.current.blobs = next;
      latest.current.onChange(next);
    },
    busy: (value) => { setBusy(value); latest.current.onBusyChange?.(value); },
    error: (error) => latest.current.toast(error instanceof Error ? error.message : "Gagal menyiapkan foto", "error"),
  });
  useEffect(() => () => { batch.current?.cancel(); }, []);
  return (
    <div className="grid grid-cols-4 gap-2" aria-busy={busy}>
      {blobs.map((b, i) => (
        <PendingThumb
          key={i}
          blob={b}
          onDelete={!busy && !disabled ? () => {
            if (batch.current?.busy) return;
            const next = latest.current.blobs.filter((photo) => photo !== b);
            latest.current.blobs = next;
            latest.current.onChange(next);
          } : undefined}
        />
      ))}
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-500"
      >
        <Camera className="size-5" />
        <span className="text-[10px]" role="status">{busy ? "Menyiapkan…" : label}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        disabled={busy || disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!disabled) void batch.current?.add(files);
        }}
      />
    </div>
  );
}

function PendingThumb({ blob, onDelete }: { blob: Blob; onDelete?: () => void; }) {
  const url = useObjectUrl(blob);
  const [full, setFull] = useState(false);
  return (
    <div className="relative aspect-square">
      <button type="button" aria-label="Lihat foto ukuran penuh" onClick={() => setFull(true)} className="h-full w-full">
      {url && (
        <img src={url} alt="Foto" className="h-full w-full rounded-xl object-cover" />
      )}
      </button>
      {onDelete && (
      <button
        type="button"
        onClick={onDelete}
        aria-label="Hapus foto"
        className="absolute right-1 top-1 rounded-lg bg-slate-950/60 p-1 text-white"
      >
        <Trash2 className="size-3.5" />
      </button>
      )}
      {full && url && <FullPhoto url={url} onClose={() => setFull(false)} />}
    </div>
  );
}

/** Foto pertama sebuah entitas (thumbnail list). */
export function FirstPhoto({
  refType,
  refId,
  className,
}: {
  refType: Photo["refType"];
  refId: string;
  className?: string;
}) {
  const photo = useLiveQuery(
    () => db.photos.where({ refType, refId }).first(),
    [refType, refId],
  );
  const url = useObjectUrl(photo?.blob);
  if (!url)
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl bg-slate-100 text-slate-300",
          className,
        )}
      >
        <Camera className="size-5" />
      </div>
    );
  return (
    <img src={url} alt="" className={cn("rounded-xl object-cover", className)} />
  );
}
