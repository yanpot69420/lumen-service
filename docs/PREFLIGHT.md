# Pemeriksaan sebelum deployment — 21 Oktober 2026

Pemeriksaan memakai data contoh di memori, tanpa mengubah data toko atau layanan Supabase sungguhan. Pengujian menjalankan fungsi bisnis lokal melalui IndexedDB tiruan, aturan SQL melalui PostgreSQL PGlite, dan skenario asynchronous untuk pencarian publik. Pemeriksaan kode antarmuka melengkapi tes tersebut.

## Hasil akhir

| Pemeriksaan | Hasil |
|---|---|
| Seluruh pengujian | **145 lulus, 0 gagal**, 688 pemeriksaan pada 17 file; durasi 4,42 detik. |
| Tambahan dari pemeriksaan ini | **41 tes baru** untuk regresi dan skenario alur bisnis. |
| TypeScript dan build produksi | Lulus; bundle utama sekitar 395 kB, tanpa peringatan chunk lebih dari 500 kB. |
| TypeScript fungsi server | Lulus. |
| Konsistensi seed | Lulus, 30 sparepart. |
| Whitespace perubahan | Lulus. |

## Cakupan dan perbaikan

| Alur | Temuan yang diperbaiki dan bukti |
|---|---|
| Penerimaan dan pengerjaan servis | Harga normal maupun “Langsung kerjakan”, penggunaan part, transaksi atomik, dan rollback diperiksa. Rincian biaya dari form lama kini ditolak saat nota sudah berubah, sehingga pengambilan/pembatalan/revisi tidak memakai tagihan yang belum ditinjau operator. |
| Perubahan nota dan pelanggan | Form menjaga salinan data saat dibuka. Perubahan yang lebih baru tidak dapat tertimpa oleh form lama; pengakuan sinkronisasi yang tidak mengubah isi tetap diterima. |
| Garansi dan Undo | Garansi wajib merujuk nota asal tersimpan yang sudah diambil, bukan klaim garansi lain. Data sumber dibaca ulang. Undo pengambilan ditolak bila sudah ada klaim terkait; Undo klaim terlebih dahulu memulihkan urutan yang valid. Kebijakan klaim lewat tenggat tetap mengikuti kebijakan konter yang sudah ada. |
| Penjualan dan retur HP | Retur tidak dapat menciptakan dua stok aktif dengan IMEI sama. Refund Rp0 tetap menyimpan jurnal pemulihan modal; penjualan ulang tidak membebankan modal dua kali. Server menolak refund di atas harga jual dan retur tanpa jurnal. |
| Sparepart dan opname | Penjualan bersamaan tidak membuat stok negatif. Form opname lama tidak dapat menimpa stok yang sudah berubah. Restok berbiaya menggunakan modal rata-rata; biaya Rp0 tetap bermakna telah dibayar terpisah, sesuai petunjuk aplikasi. |
| Kas dan laporan | Tunai dipisahkan dari QRIS/transfer. Penutupan kas dan kegagalan pencatatan menjaga atomisitas. Form koreksi lama ditolak bila jurnal berubah. Jurnal retur tidak dapat di-void karena dibutuhkan riwayat modal; nominal refund tetap boleh dikoreksi hingga Rp0. Part yang tetap terpakai saat servis dibatalkan dibebankan pada bulan pembatalan; part yang dilepas sebelumnya direstok dan tidak dibebankan. |
| Backup dan akun | Backup dengan jenis nominal, metadata kas, kredensial, referensi garansi, atau IMEI stok yang rusak ditolak sebelum pemulihan. Enkripsi diuji dengan passphrase salah, data yang diubah, teks Unicode, dan foto melintasi beberapa blok base64. Cache login offline rusak ditolak; reset PIN/nonaktif akun membersihkan kredensial offline terkait. |
| Pencarian publik | Respons pencarian lama tidak dapat menimpa pencarian terbaru. Mengubah input atau meninggalkan halaman membatalkan pengaruh respons lama. Pencarian gagal menghapus hasil nota sebelumnya. Nomor nota dan empat digit WA tetap diwajibkan. |
| Tampilan dan formulir | Halaman cetak membedakan proses memuat, data tidak ditemukan, dan rute tidak valid. Biaya jasa final Rp0 diberi label yang benar. Tindakan akun dikunci selama permintaan berlangsung; panel tidak bisa ditutup atau disubmit ulang saat menyimpan. Banner pembaruan dibatasi lebar layar. |

Skenario tambahan berada di `tests/preflight-service.test.ts`, `tests/preflight-stock-cash.test.ts`, `tests/preflight-cloud.test.ts`, `tests/public-status-lookup.test.ts`, dan `tests/backup-crypto.test.ts`. Regresi bisnis utama direproduksi gagal sebelum perbaikan, lalu lulus setelahnya. Pemeriksaan silang kode servis dan stok/kas dilakukan secara terpisah.

## Ketentuan rilis

- Pasang `202610210001_preflight_integrity.sql` sesudah tujuh migrasi sebelumnya. Skema instalasi baru telah disamakan; tes memeriksa hasil upgrade, pemuatan ulang migrasi, dan kegagalan yang mempertahankan data bila ada IMEI stok ganda.
- Rilis frontend, fungsi server, dan skema yang cocok secara bersamaan. Jurnal retur adalah bagian permanen riwayat modal, termasuk bila refund Rp0.
- Gunakan staging terlebih dahulu dengan backup database dan foto, serta pastikan antrean lama sudah kosong atau direkonsiliasi. Tidak ada deploy atau migrasi ke layanan nyata dilakukan dalam pemeriksaan ini.

## Batas bukti

Hasil ini mendukung kelanjutan ke staging. Belum menjadi bukti bahwa seluruh operasi produksi bebas bug.

Akses browser sebelumnya ditolak oleh kebijakan lingkungan. Karena itu interaksi visual web/mobile tidak dijalankan ulang melalui browser, dan tidak ada pengganti browser yang dipakai untuk melewati pembatasan tersebut. Kamera, keyboard perangkat, pemasangan/offline PWA, printer thermal 58 mm, serta konflik dua perangkat pada Supabase/Storage/Edge Functions sungguhan tetap harus diperiksa pada lingkungan sasaran. Rewrite rute dan HTTPS juga perlu dibuktikan pada hosting yang dipilih.

Perhitungan biaya servis berjalan tetap memakai kebijakan yang sudah ada: modal part diakui saat nota ditutup. Kebijakan bagi hasil, biaya garansi, dan penyesuaian transaksi historis memerlukan kesepakatan operasional toko.
