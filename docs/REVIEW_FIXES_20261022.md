# Perbaikan hasil review 22 Oktober 2026

Perubahan disiapkan pada branch `codex/perbaikan-hasil-review-lengkap`. Tidak ada data production yang diubah, deployment, atau push ke GitHub sebagai bagian dari pekerjaan ini.

## Perilaku yang diperbaiki

| Area | Perilaku setelah perbaikan |
| --- | --- |
| Pergantian akun | State formulir/modal dibongkar saat akun atau peran berubah. Kasir/Teknisi hanya melihat koreksi miliknya; snapshot modal disembunyikan dari tampilan mereka. |
| Transaksi Kasir/Teknisi | Validasi server memakai modal asli yang tersimpan ketika payload akun terbatas berisi modal tersembunyi. Penjualan HP/part dan pemakaian part tetap diterima tanpa memberi akun tersebut hak mengubah modal. |
| Antrean sinkronisasi | Batch mencatat pelaku transaksi. Batch akun lain, batch yang bergantung padanya, dan identitas legacy yang tidak dapat dipastikan tetap ditahan. Batch independen akun aktif dapat dikirim. |
| Pull dan sesi | Push gagal tetap mengizinkan pull yang melindungi perubahan lokal. Respons sesi lama tidak diterapkan setelah akun berganti. Waktu sinkron terakhir hanya maju saat siklus berhasil. |
| Koreksi pembelian HP | Perubahan nominal pembelian ikut mengubah modal unit secara atomik. Berlaku hanya untuk unit stok yang belum pernah terjual/retur dan memiliki satu sumber pembelian yang valid. Pembatalan pembelian melalui kas ditolak. |
| Pembatalan penjualan part | Stok dikembalikan satu kali. Modal stok dihitung ulang dari nilai stok saat ini ditambah modal asli barang yang kembali. Transaksi yang sudah dibatalkan tidak dapat diaktifkan kembali; buat penjualan baru. |
| Kas yang ditutup | Koreksi baru dan persetujuan koreksi tertunda ditolak untuk periode tertutup, termasuk data lama yang memiliki catatan tutup kas tetapi flag pengunciannya hilang. Penolakan permintaan tetap diizinkan. |
| Form edit sparepart | Snapshot katalog dibandingkan dengan data terbaru sebelum simpan. Form lama tidak dapat menimpa perubahan nama, merek, harga jual, atau stok minimum dari form/perangkat lain. Stok dan modal terbaru tetap dipertahankan. |
| Stok awal | Form item baru menyediakan metode tunai, QRIS, atau transfer untuk jurnal pembelian stok awal. |
| Foto dan draft pembelian | Penambahan foto diproses per batch dan submit menunggu kompresi selesai. Draft ditulis berurutan serta di-flush saat navigasi; proses submit menunggu penulisan selesai sebelum draft dibersihkan. Kegagalan memuat draft dapat dicoba kembali tanpa menimpanya. |
| Nota langsung | Sinkronisasi tetap mengikuti sesi pada rute cetak. Nota yang belum ada di cache dapat dimuat dari server; keadaan offline/error dibedakan dari nota tidak ditemukan. |
| Margin dan audit | Margin negatif ditampilkan dengan tanda minus. Pencarian audit menjangkau seluruh riwayat yang tersedia di perangkat, dengan tanggal WITA dan pagination. |
| Status dan istilah | Pusat Sinkronisasi menampilkan antrean dan kendalanya. Status tidak menyebut seluruh data tersinkron jika masih ada antrean. Istilah di form/detail servis menjadi “Biaya jasa tambahan”. |

Snapshot harga/nama dalam transaksi historis tidak ditulis ulang. Selisih dari transaksi lama memerlukan rekonsiliasi berdasarkan bukti transaksi; perbaikan ini tidak menebak nilai yang benar.

## Pemeriksaan

Hasil akhir: **241 tes lulus, 0 gagal**, dengan 1.162 assertion pada 27 file pengujian.

- Regresi lokal memakai fake IndexedDB; validasi SQL, rollback, idempotensi, payload manipulasi, dan upgrade migrasi memakai PostgreSQL PGlite di memori. Transaksi Kasir/Teknisi diuji dengan cache hasil `sync_page` yang telah menyembunyikan modal, serta input modal palsu yang harus diabaikan server.
- Skenario sinkronisasi memakai cloud tiruan, termasuk pergantian akun, dependensi batch, pull saat push gagal, dan akses koreksi.
- Regresi foto, buffered draft, pencarian audit, serta margin diuji tanpa memakai database toko.
- Build produksi, TypeScript fungsi server, kesesuaian seed, dan audit dependensi diperiksa. Patch dependensi diterapkan dalam rentang kompatibel, termasuk React Router dan Vite.

Pengujian otomatis tidak menggantikan uji perangkat, printer fisik, atau koneksi Supabase production. Ikuti daftar pemeriksaan perangkat pada [DEPLOYMENT.md](DEPLOYMENT.md).

## Urutan rilis

1. Buat backup aplikasi dan database. Rekonsiliasikan antrean lama; jangan menghapus cache untuk menghilangkan error.
2. Uji migrasi dan frontend pada staging dengan salinan data yang sesuai.
3. Terapkan `supabase/migrations/202610220001_review_business_integrity.sql` setelah seluruh migrasi sebelumnya, sebelum merilis frontend yang sama. `docs/supabase/schema.sql` sudah mencakupnya untuk instalasi baru.
4. Perbarui semua perangkat dan login ulang. Periksa Pusat Sinkronisasi untuk antrean yang memerlukan akun asal atau rekonsiliasi.
5. Uji koreksi pembelian HP, pembatalan part setelah restok dengan modal berbeda, kas tertutup, perpindahan akun, serta tautan nota dari perangkat kedua.

Pekerjaan lokal ini tidak menjalankan langkah rilis di production.
