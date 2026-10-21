# Menjalankan dan memperbarui Lumen

Mode lokal dapat dijalankan tanpa Supabase. Perubahan server dalam rilis ini disiapkan sebagai file migrasi dan Edge Functions; mengubah workspace tidak otomatis menerapkannya ke proyek Supabase.

## Pengembangan lokal

Dengan Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run dev
bun test
bun run build
bun run check:functions
```

Dengan npm, `npm install` dan `npm run dev` juga dapat menjalankan aplikasi. Pengujian repo menggunakan Bun. Port pengembangan tetap 3000; preview produksi 3001. Direktori `dist/` adalah hasil build untuk hosting statis dengan rewrite SPA ke `/index.html`.

## Vercel

`vercel.json` menetapkan Vite, build `npm run build`, keluaran `dist`, dan rewrite rute SPA. Integrasi Vercel–Supabase dapat menyediakan `SUPABASE_URL`/`SUPABASE_ANON_KEY` atau nama `NEXT_PUBLIC_*`; konfigurasi build memetakannya secara eksplisit ke dua nilai publik Vite. Variabel `VITE_SUPABASE_*` tetap memiliki prioritas. Publishable key juga didukung. URL dan key harus tersedia bersama agar deployment tidak diam-diam berpindah ke mode lokal.

Hanya URL dan anon/publishable key yang dimasukkan ke frontend. Service-role key, JWT secret, dan kredensial PostgreSQL tidak dipetakan; build menolak secret key yang salah dipasang sebagai key publik.

Pengujian tidak memakai database toko: IndexedDB diuji dengan fake-indexeddb dan PostgreSQL dengan PGlite di memori. CI memasang dependensi sesuai `bun.lock`, menjalankan test, build, dan pemeriksaan TypeScript fungsi server.

## Supabase baru

1. Buat proyek Supabase terpisah untuk toko. Jangan memakai satu database Lumen untuk beberapa toko: skema ini adalah satu toko per proyek.
2. Jalankan [schema.sql](/Users/mac/Workspace/lumen-service/docs/supabase/schema.sql) hanya pada database baru. File tersebut sudah mencakup semua migrasi berikutnya.
3. Atur secret Edge Function `LUMEN_SETUP_TOKEN` dengan nilai acak panjang. Secret ini diberikan kepada Owner untuk satu kali bootstrap; jangan taruh di variabel `VITE_*` atau kode frontend.
4. Deploy fungsi `auth` dan `public` dari `supabase/functions/`. Keduanya menerima permintaan awal tanpa JWT pengguna; konfigurasi `verify_jwt = false` tercatat di `supabase/config.toml`. Fungsi `auth` memverifikasi JWT sendiri untuk pengelolaan staf.
5. Isi `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` saat build frontend. Service-role key hanya berada pada lingkungan Edge Function.
6. Buka `/app/setup` pada profil browser/perangkat yang belum memiliki data toko lain. Masukkan token setup, data toko, dan akun awal. Simpan kode pemulihan di luar perangkat.

Token setup tidak dapat dipakai lagi setelah tabel pengguna berisi data. Penguncian bootstrap di database mencegah dua request membuat dua pasangan Owner/Head Ops.

## Memperbarui Supabase yang sudah berisi data

Selesaikan pekerjaan ini pada salinan/staging terlebih dahulu. Koordinasikan jeda pencatatan selama perubahan server dan aplikasi dipasang bersama.

1. Unduh backup aplikasi beserta foto dan buat backup database Supabase. Pastikan antrean versi lama sudah kosong. Jika masih ada antrean lama yang belum terkirim, simpan backup dan lakukan rekonsiliasi sebelum upgrade; aplikasi baru mempertahankan antrean itu dan menolak mengirimnya tanpa konteks transaksi yang dapat diverifikasi.
2. Jalankan file berikut berurutan, satu kali:

   - [202610200001_integrity.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200001_integrity.sql)
   - [202610200002_auth_storage.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200002_auth_storage.sql)
   - [202610200003_public.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200003_public.sql)
   - [202610200004_service_workflow.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200004_service_workflow.sql)
   - [202610200005_part_brands.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200005_part_brands.sql)
   - [202610200006_simplify_part_brands.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200006_simplify_part_brands.sql)
   - [202610200007_customers.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200007_customers.sql)
   - [202610210001_preflight_integrity.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610210001_preflight_integrity.sql)
   - [202610210002_purchase_corrections.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610210002_purchase_corrections.sql)

3. Deploy versi baru fungsi `auth` dan `public`, lalu frontend dari build yang sama. Versi frontend lama tidak kompatibel dengan akses tabel yang kini ditutup. Jika server belum diperbarui, frontend baru menampilkan error dan mempertahankan antrean.
4. Minta staf login ulang. PIN lama dipertahankan di penyimpanan privat server; hash SHA-256 lama di-upgrade saat login berhasil. Profil yang ditarik ke perangkat tidak lagi berisi hash PIN/recovery staf lain.
5. Periksa policy kustom yang pernah dibuat di proyek, terutama `storage.objects`, supaya tidak ada policy tambahan yang memberi akses lebih luas daripada policy Lumen. Bucket `photos` harus privat.

Migrasi tidak mengosongkan tabel bisnis. Hash dipindahkan ke skema `private`; akun Auth lama dihubungkan melalui email staf yang sudah digunakan aplikasi. Jangan menjalankan ulang skema instalasi baru pada database lama dan jangan mengganti kredensial cloud untuk menghubungkan cache browser toko lain.

Migrasi `202610210001_preflight_integrity.sql` menambahkan perlindungan IMEI stok aktif, sumber garansi, serta jurnal retur termasuk refund Rp0. Jika data lama memiliki IMEI ganda pada stok aktif, migrasi berhenti tanpa menghapus data; Owner perlu merekonsiliasi pencatatan di staging sebelum mencoba kembali. Frontend dan server terbaru harus dirilis bersama: klien lama yang mengirim retur tanpa jurnal refund Rp0 akan ditolak server dan antreannya perlu diperiksa.

## Perilaku data dan sinkronisasi

Koreksi pembelian langsung oleh Owner/HO memerlukan migrasi `202610210002_purchase_corrections.sql` sebelum frontend baru dipasang. Migrasi mempertahankan data lama, menambahkan validasi transaksi pembelian lengkap, serta membatasi pengecualian hak koreksi HO hanya pada stok dan jurnal pembelian yang tertaut. Frontend baru menyimpan snapshot jumlah dan modal saat pembelian; klien lama yang mengubah modal sendiri atau melakukan restok tanpa snapshot ketika modal berubah perlu diperbarui. Jangan menerapkan koreksi pada data production sebelum migrasi dan frontend yang cocok siap. Lihat [PURCHASE_CORRECTIONS.md](PURCHASE_CORRECTIONS.md).

- Satu transaksi lokal menyimpan entitas, kas, stok, audit, dan payload antreannya bersama. Server menerima satu transaksi tersebut melalui RPC atomik dengan ID pengiriman ulang dan pemeriksaan revisi.
- Antrean tidak dihapus hanya karena membesar. Perubahan yang belum terkirim tidak ditimpa oleh pull. Jika ada konflik, status menampilkan error dan perubahan lokal tetap dipertahankan. Jangan menghapus data browser untuk mengatasi konflik; simpan backup dan rekonsiliasikan transaksi dengan Owner.
- Kode servis baru memakai `LS-` dan 12 karakter acak (60 bit), tanpa huruf/angka 0/O dan 1/I yang mudah tertukar. Aplikasi memeriksa benturan lokal; constraint unik server tetap melindungi benturan antarperangkat. Kode unit masih memakai identitas perangkat; pemulihan lokal mengganti identitas tersebut. Nota lama tetap dapat dibaca.
- Opsi “Langsung kerjakan” saat mengajukan harga menyimpan konfirmasi harga dan mulai pengerjaan dalam satu transaksi, dengan dua langkah riwayat. Migrasi `202610200004_service_workflow.sql` wajib dipasang agar transisi gabungan diterima server; lanjutkan seluruh migrasi berikutnya dalam daftar sebelum memakai frontend terbaru.
- Pengelompokan merek sparepart memerlukan `202610200005_part_brands.sql` sebelum frontend dan seed SQL terbaru digunakan. Migrasi menambah kolom/index/validasi tanpa menulis ulang barang atau revisi yang sudah ada. Staf terbatas tetap tidak dapat mengubah merek melalui sinkronisasi; perubahan klasifikasi hanya untuk Owner/Head Operasional.
- Foto dikirim ke bucket privat dengan metadata. Foto KTP hanya dapat dibaca Owner/Head Ops. Foto bukti yang dihapus dari tampilan dicatat dalam audit; objek cloud tidak ditimpa atau dihapus permanen melalui API staf.
- Akses offline cloud hanya tersedia untuk staf terakhir yang berhasil login online di perangkat itu, selama 24 jam. Kunci otomatis mempertahankan hak offline terbatas tersebut; logout manual menghapusnya. Pengguna lain dan recovery cloud memerlukan koneksi. Penonaktifan staf di server menolak akses cloud segera; perangkat yang sepenuhnya offline tetap memiliki cache sampai batas akses offline berakhir.
- Kas yang sudah ditutup menolak pencatatan baru untuk tanggal itu. Koreksi dilakukan melalui jurnal. Tanggal bisnis dan tampilan waktu mengikuti `Asia/Makassar`.
- Backup dibuat dari satu snapshot. Pemulihan lokal memvalidasi isi dan menyimpan salinan sebelumnya secara atomik. Tombol pengunduhan salinan sebelumnya tersedia di Pengaturan. Backup cloud tidak boleh menimpa cache lokal; restore cloud dilakukan dari backup database oleh administrator.
- Pendataan pelanggan memerlukan migrasi `202610200007_customers.sql`. Backup baru memakai versi 4 dengan profil pelanggan serta hubungan nota; backup 1–3 tanpa pelanggan tetap didukung. Rilis frontend bersama ke semua perangkat agar hubungan pelanggan pada nota tertaut tidak hilang saat dikirim klien lama. Konflik pelanggan identik dari dua perangkat offline dipertahankan untuk rekonsiliasi; lihat [CUSTOMERS.md](/Users/mac/Workspace/lumen-service/docs/CUSTOMERS.md).
- Data foto lokal dari versi lama dimasukkan ke antrean saat sesi cloud aktif, tanpa menggandakan foto yang sudah menunggu. Arsipkan backup beserta foto sebelum migrasi dan tunggu antrean selesai; jangan menganggap foto lama sudah tercadangkan hanya karena data tiketnya ada di server.

## Pemeriksaan rilis di perangkat sasaran

Pengujian otomatis mencakup transaksi, rollback, pengiriman ulang, konflik revisi, akses peran, recovery sekali pakai, perlindungan foto, pagination, dan batas data publik. Sebelum operasional penuh, periksa juga:

- Instal PWA pada Android/iPhone, buka ulang setelah offline, lalu sambungkan kembali dan periksa antrean.
- Tutup aplikasi saat transaksi sedang disimpan atau dikirim, lalu pastikan tidak ada pencatatan ganda.
- Coba dua perangkat menjual unit yang sama: satu pengiriman server harus ditolak, dan perangkat yang ditolak harus menunjukkan konflik.
- Cetak nota 58 mm dan label pada printer yang dipakai toko. Driver thermal dan dukungan cetak browser tetap diperlukan.
- Verifikasi foto kondisi/KTP dapat dilihat dari perangkat kedua sesuai peran; cek produk publik tidak pernah menampilkan foto KTP.
- Cek status dari browser tanpa login memakai nomor nota dan empat digit terakhir nomor WA pelanggan; nama pelanggan, keluhan, dan catatan internal tidak boleh ikut respons.
- Coba backup terenkripsi, passphrase salah, file tidak lengkap, dan pemulihan pada salinan perangkat.

Pengujian perangkat, printer fisik, dan layanan Supabase yang benar-benar ter-deploy tidak digantikan oleh hasil pengujian lokal.

Hasil pemeriksaan sebelum deployment beserta bug yang diperbaiki dicatat di [PREFLIGHT.md](PREFLIGHT.md). Hosting harus melayani ulang `/index.html` untuk rute SPA seperti `/app/servis/...`, `/cek`, dan `/katalog`; pengaturan rewrite perlu diverifikasi pada hosting yang dipilih.

Kategori stok yang ditampilkan dibatasi menjadi Samsung, Apple, Vivo, Oppo, Xiaomi, Realme, Infinix, Tecno, Universal, dan Lainnya. Migrasi `202610200006_simplify_part_brands.sql` menerima label baru sekaligus mempertahankan dukungan nilai lama agar data dan antrean tidak perlu ditulis ulang. iPhone tampil sebagai Apple; merek lama di luar daftar tampil sebagai Lainnya.
