# D&R GadgetCare

PWA operasional konter servis HP dan jual beli HP second, untuk HP dan desktop.

## Menjalankan

```sh
bun install --frozen-lockfile
bun run dev              # http://localhost:3000
bun test                 # pengujian lokal, tanpa data toko
bun run build            # TypeScript + build ke dist/
bun run check:functions  # TypeScript fungsi server
bun run preview          # http://localhost:3001
```

Bun yang dipakai CI: 1.4.3. Untuk menjalankan aplikasi dengan npm, gunakan `npm install` lalu `npm run dev`. Pengujian repo tetap memakai Bun.

## Fitur

- Ruang kerja mobile khusus: beranda operasional, navigasi bawah dengan tombol Nota baru, kartu servis/stok/pelanggan, dan form sentuh. Lihat [panduan mobile](docs/MOBILE.md).
- Ruang kerja desktop: sidebar berkelompok, ringkasan dan antrean kerja di beranda, daftar berkolom, serta detail dua kolom. Desktop dan mobile memakai tema monokrom dengan aksen oranye yang sama. Lihat [panduan tema](docs/THEME.md).
- Pelanggan: profil nama/WA, catatan internal, penanda langganan, pencarian, dan riwayat servis. Profil dapat dipilih saat membuat nota; perubahan profil tidak menulis ulang identitas nota lama.
- Input nota servis ringkas: pencarian pelanggan dari riwayat, satu isian merek/tipe, pilihan keluhan, kelengkapan, dan foto awal wajib. Form penerimaan tanpa DP maupun estimasi biaya; draft tersimpan otomatis.
- Servis lanjutan: status pengerjaan, harga final, pelunasan, piutang, garansi, WhatsApp, dan nota thermal 58 mm. DP/estimasi pada nota lama tetap terbaca.
- Snackbar nota: status penyimpanan dan tombol Undo selama 8 detik untuk draft, submit, status, harga, sparepart, pembayaran, garansi, serta foto. Pembatalan menjaga stok/kas dan menolak penimpaan perubahan terbaru. Lihat [panduan Undo](docs/SERVICE-UNDO.md).
- Unit HP: IMEI 15 digit dengan digit cek, foto unit/KTP, pembelian, penjualan, retur, dan margin.
- Sparepart: kategori merek HP (Samsung, Apple, Vivo, Oppo, Xiaomi, Realme, Infinix, Tecno, Universal, Lainnya), pencarian nama/merek/tipe, filter jenis dan kondisi stok, penjualan cepat, pemakaian servis, restok dengan biaya, stok minimum, serta penyesuaian beralasan.
- Keuangan: tunai/QRIS/transfer, tutup kas, koreksi dengan persetujuan Owner, serta audit.
- Backup lokal: validasi, enkripsi opsional, snapshot konsisten, dan salinan pengaman sebelum pemulihan.
- Cloud opsional: autentikasi staf, RPC atomik, antrean offline, revisi untuk deteksi konflik, pagination, dan foto privat.
- Web publik cloud: profil, katalog dengan foto unit yang aman, dan pencarian status dengan nota + empat digit nomor WA. Dalam mode lokal, halaman publik hanya menjadi pratinjau data perangkat.

## Mode data

Tanpa variabel Supabase, data disimpan di IndexedDB browser. Bekerja offline, tetapi tidak otomatis pindah ke perangkat lain. Unduh backup rutin beserta foto.

Dengan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`, aplikasi memakai server Supabase yang sudah dipasangi skema, migrasi, dan Edge Functions yang cocok. Jangan pernah menaruh service-role key di frontend. Akses staf dan data sensitif dibatasi server; hash PIN staf lain tidak dikirim ke perangkat.

Perubahan lokal dan antrean disimpan bersama. Antrean hanya dihapus setelah transaksi diakui server. Konflik tidak diselesaikan dengan membuang data: aplikasi menampilkan error agar transaksi dapat direkonsiliasi. Akses offline cloud dibatasi untuk staf terakhir di perangkat, maksimal 24 jam sejak login online, dan dihapus saat logout manual.

Tanggal bisnis menggunakan Asia/Makassar. Kode servis baru memakai `LS-` diikuti 12 karakter acak agar ringkas dan dapat dibuat offline. Kode unit tetap memakai penanda perangkat. Nota lama tetap didukung.

## Instalasi dan pembaruan cloud

Ikuti [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Database baru memakai [schema.sql](docs/supabase/schema.sql); database berisi data memakai file migrasi berurutan di `supabase/migrations/`. Setup cloud baru memerlukan secret `LUMEN_SETUP_TOKEN` dari administrator.

Versi server dan frontend dalam rilis ini harus dipasang bersama. Pemulihan backup cloud dilakukan pada database oleh administrator; fitur import JSON hanya untuk mode lokal. Antrean dari versi lama yang belum memiliki payload transaksi dipertahankan untuk rekonsiliasi, bukan dikirim ulang secara membabi buta.

Fitur pelanggan memerlukan migrasi `202610200007_customers.sql` di cloud. Data pelanggan ikut backup versi 4; backup versi 1–3 tanpa tabel pelanggan tetap dapat dipulihkan. Panduan operasional ada di [docs/CUSTOMERS.md](docs/CUSTOMERS.md).

Pemeriksaan sebelum deployment menghasilkan **145 tes lulus** dan perbaikan alur servis, garansi, retur, stok, koreksi kas, backup, serta pencarian publik. Rilis ini juga memerlukan migrasi `202610210001_preflight_integrity.sql`. Bukti dan batas pengujian tercatat di [docs/PREFLIGHT.md](docs/PREFLIGHT.md); lanjutkan ke staging sebelum operasional produksi.

## Seed sparepart

Untuk Supabase, jalankan [supabase/seed.sql](supabase/seed.sql) setelah skema terpasang. Seed berisi 30 barang dengan stok dan harga nol; barang yang sudah ada dilewati. Sumber JSON dan helper lokal tetap tersedia untuk pengembangan; pemuatan seed tidak ditampilkan pada halaman stok. Cara pemakaian dan perubahan data ada di [docs/SEED.md](docs/SEED.md).

Rencana bisnis awal ada di [PLANNING.md](PLANNING.md). Temuan review awal dicatat dalam [docs/REVIEW.md](docs/REVIEW.md); status perbaikannya ada di [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).
