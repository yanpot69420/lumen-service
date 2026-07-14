# Lumen Service

Sistem operasional konter servis HP & jual beli HP second — PWA yang bisa
di-install di HP Android/iPhone dan dipakai di PC konter.

Lihat [PLANNING.md](PLANNING.md) untuk konteks bisnis & keputusan desain.

## Fitur

- **Servis (ticketing):** nota masuk cepat + foto kondisi, alur status
  `Masuk → Dicek → Konfirmasi → Dikerjakan → Selesai → Diambil`, sparepart
  otomatis memotong stok, kirim update WA, cetak nota 58mm.
- **Jual beli HP:** stok unit ber-IMEI wajib, foto unit + KTP penjual,
  margin per unit, umur stok.
- **Sparepart & aksesoris:** stok, peringatan menipis, jual cepat.
- **Kas:** semua transaksi tercatat otomatis, tutup kas harian dengan
  hitung selisih, kas manual (operasional/prive/modal).
- **Integritas:** transaksi tidak bisa dihapus — jurnal koreksi dengan
  persetujuan Owner; audit log dua arah untuk semua aksi.
- **Peran:** Owner & Head Operasional (akses penuh); Kasir/Teknisi tersedia
  untuk saat merekrut karyawan.
- **Web publik:** landing page, katalog HP second, cek status servis via
  nomor nota.

## Menjalankan

```bash
bun install
bun run dev      # http://localhost:3000  (JANGAN port 5173 — diblokir di mesin dev)
bun run build    # type-check + build produksi ke dist/
bun run preview  # serve hasil build di :3001
```

Kunjungan pertama ke `/app` akan membuka **setup wizard**: nama toko + akun
Owner + akun Head Operasional (PIN 4–6 digit).

## Arsitektur data (penting dipahami)

Aplikasi ini **local-first**: seluruh data tersimpan di IndexedDB perangkat
(via Dexie). Konsekuensinya:

- Bekerja penuh **offline** — internet putus tidak menghentikan operasional.
- Data HP dan PC konter **belum otomatis sinkron**. Untuk fase rintisan,
  jalankan operasional di **satu perangkat utama** (HP head ops), dan
  pindahkan data lewat **Pengaturan → Backup** (export/import JSON).
- **Wajib unduh backup rutin** (idealnya tiap tutup kas) dan simpan ke
  Google Drive — data ikut hilang bila aplikasi/HP di-reset.

Saat siap multi-perangkat (owner pantau real-time dari jauh), jalankan
[docs/supabase/schema.sql](docs/supabase/schema.sql) di project Supabase
milik sendiri lalu integrasikan lapisan sinkronisasi. Skema DB lokal sudah
dibuat sejajar dengan skema Supabase agar migrasi mulus.

## Deploy web publik

Build (`bun run build`) lalu deploy folder `dist/` ke Vercel/Netlify
(framework preset: Vite). Tambahkan rewrite SPA `/* → /index.html`.
Catatan: sebelum integrasi Supabase, katalog & cek status di web publik
hanya membaca data perangkat yang membukanya — fitur publik lintas
perangkat menyala setelah backend terpasang.

## Cetak nota

Halaman nota memakai CSS `@page 58mm` — bisa dicetak via:
- Printer thermal Bluetooth yang punya driver/app print service Android
  (RawBT dsb.) — pilih lebar 58mm.
- Atau tombol **WA** di halaman nota untuk kirim nota sebagai teks.
