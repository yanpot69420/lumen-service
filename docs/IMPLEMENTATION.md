# Status perbaikan review

Perbaikan kode diselesaikan mengikuti urutan laporan: perlindungan data, konsistensi transaksi, keamanan cloud, sinkronisasi, lalu kelengkapan rilis. Catatan ini membedakan implementasi di repo dari penerapan ke layanan sungguhan.

## Temuan utama

| Temuan | Perubahan |
|---|---|
| R02 — Status cloud menghapus cache | Error query menjadi respons gagal; CloudBoot hanya menentukan navigasi dan tidak mengosongkan database. |
| R03 — Antrean besar dibuang | Penghapusan otomatis dihapus. Antrean diproses bertahap dan hanya dilepas setelah diakui server. |
| R04 — Pull menimpa perubahan | Baris yang masih tertunda dilindungi dalam transaksi; payload utuh tersimpan di outbox. Pemeriksaan revisi server menolak konflik. |
| R08 — Backup tidak lengkap | Validasi versi, tabel, tipe, identitas, dan referensi sebelum restore; snapshot sebelum pemulihan; restore cloud tidak menimpa cache. |
| R05 — Transaksi parsial | Operasi servis, unit, stok, kas, koreksi, tutup kas, dan audit memakai transaksi lokal; RPC menerapkan satu graph perubahan secara atomik. |
| R06 — Duplikasi dan snapshot lama | Baca ulang status dalam transaksi, permintaan pembuatan ber-ID, rincian part digabung dari tiket terbaru, ID batch server idempotent. Kode servis memakai 60 bit acak dengan pemeriksaan benturan lokal dan constraint unik server; kode unit beridentitas perangkat. |
| R07 — Refund tetap menjadi laba | Pendapatan servis dihitung neto terhadap refund pada periode refund. |
| R09 — Harga nol kembali ke estimasi | Penanda harga final eksplisit membedakan nol dengan harga yang belum disepakati. |
| R10 — Nota lunas masih menyebut sisa | Tiket diambil memakai piutang berjalan; WA menampilkan LUNAS bila saldonya nol. Koreksi DP merekonsiliasi tiket, termasuk saat keterangannya diganti. |
| R01 — Akses cloud terlalu luas | Akses tabel langsung ditutup, staf terhubung ke Auth, kredensial privat, pembatasan peran/kolom di server, dan audit commit dari identitas sesi. |
| R11 — Sesi, offline, recovery | Logout lokal/cloud diselaraskan, akses offline hanya staf terakhir selama 24 jam, recovery sekali pakai di server, sesi staf yang direset/nonaktif ditolak. |
| R15 — Percobaan PIN tanpa batas | Pembatasan berbasis database per akun/IP, validasi server, token setup, dan bootstrap terkunci. |
| R16 — Kebocoran peran di UI | Modal stok disembunyikan dari peran terbatas; Kas dan pengaturan toko dibatasi; operasi juga memeriksa izin. |
| R12 — Data terpotong | RPC paginasi dengan cursor stabil; diuji dengan 1.202 baris. |
| R13 — Status sukses ketika pull gagal | Error diteruskan ke status dan UI; antrean tetap disimpan, tersedia retry dan tautan backup. |
| R14 — Foto hanya lokal | Antrean upload, metadata, bucket privat, larangan menimpa objek, pembatasan KTP, download perangkat kedua, dan antrean foto lama tanpa duplikasi. |

## Kelengkapan rilis

- Tampilan mobile mempunyai susunan khusus untuk beranda, navigasi, menu, kas, dan kartu kerja servis/stok/pelanggan. Form memakai kontrol sentuh lebih besar, teks input 16 px, safe area, dan pemisahan tombol simpan/snackbar/dock. Desktop mulai 1024 px mempertahankan sidebar. Pintasan filter dan hak akses diperiksa lewat data contoh terpisah; rincian ada di [MOBILE.md](MOBILE.md).
- Snackbar nota menampilkan status penyimpanan dan Undo selama 8 detik untuk draft/submit, foto, serta semua perubahan detail. Undo lokal atomik memulihkan stok/kas, mempertahankan audit, dan menolak data yang sudah berubah/dipakai atau kas yang ditutup. Antrean cloud ditahan selama tenggat dan diklaim atomik sebelum dikirim; tidak ada transisi balik keuangan yang dikirim ke server. Panduan ada di [SERVICE-UNDO.md](SERVICE-UNDO.md).
- Menu Pelanggan memuat profil nama/WA, catatan, penanda langganan, pencarian, dan riwayat servis. Form nota memakai profil tersimpan dan menjaga salinan identitas pada nota lama. Backup versi 4 mencakup pelanggan; versi 1–3 tetap dibaca. Alur tambah profil → buat nota → riwayat, serta perlindungan draft antar pelanggan, diperiksa melalui browser dengan data di memori.
- API publik terpisah: katalog hanya field produk, foto hanya jenis unit, dan cek status memerlukan nota serta empat digit terakhir nomor WA. Identitas pelanggan, keluhan, dan catatan internal tidak ikut respons status.
- Backup membaca satu snapshot konsisten; isi foto diuji saat export/import. Migrasi IndexedDB mempertahankan pengguna, foto, dan antrean lama.
- Foto unit/KTP serta foto penerimaan servis diwajibkan pada alur pembuatannya. IMEI diperiksa di aplikasi dan pada pembuatan/perubahan unit di server.
- Draft pembelian unit menyimpan data dan foto. Timer draft servis/pembelian tidak menulis ulang draft yang sudah disimpan menjadi transaksi.
- Form penerimaan servis diringkas menjadi pelanggan, perangkat/kelengkapan, keluhan, dan foto. Pelanggan dicari dari riwayat; nomor WA yang cocok persis mengisi nama jika tidak ambigu. Merek/tipe satu isian, keluhan umum dapat dipilih, catatan opsional, dan kelengkapan tetap terlihat. DP serta estimasi tidak diinput saat penerimaan. Tombol simpan tetap terlihat, menunggu pemrosesan foto, lalu tersedia cetak, WhatsApp, detail, atau nota berikutnya.
- Pada detail nota, sparepart berada tepat di atas tombol status. Semua tindakan detail membuka modal tengah yang dapat digulir dan dikunci saat menyimpan. Pengajuan harga menyediakan opsi “Langsung kerjakan”; harga, dua langkah riwayat, audit, dan antrean disimpan atomik. Server memverifikasi harga final dan dua tambahan riwayat tanpa mengubah riwayat sebelumnya.
- Katalog awal 30 sparepart tersedia sebagai helper lokal untuk pengembangan dan seed SQL Supabase terpisah. Sumber JSON bersama, stok/harga nol, penambahan atomik, ID tetap, dan pencocokan nama mencegah pemuatan ulang menimpa data barang. Generator dan pemeriksaan CI menjaga kedua bentuk seed tetap sesuai. Halaman stok menyediakan pencarian nama/tipe dan modal filter kategori/kondisi stok; tombol pemuatan katalog tidak ditampilkan.
- Restok menghitung ulang modal rata-rata; stok awal dengan modal dicatat sebagai pembelian. Perubahan harga dan pengaturan memiliki audit.
- Detail yang tidak ditemukan memiliki pesan yang jelas. Error async tampil sebagai pemberitahuan. Dialog mengelola fokus, Escape, Tab, dan pengembalian fokus.
- Tanggal bisnis mengikuti Asia/Makassar. Halaman dimuat bertahap; build lokal terakhir menghasilkan bundle utama sekitar 387 kB, tanpa peringatan chunk >500 kB.
- Pembaruan PWA meminta pengguna menyimpan formulir dan memilih muat ulang. CI mencakup pengujian, build, dan pemeriksaan tipe fungsi server.

## Verifikasi

Pengujian Bun asli lulus: **104 kasus** di dua belas file, memakai dependensi dari `bun.lock`.

- Pengujian IndexedDB memeriksa rollback stok/kas/outbox, penjualan bersamaan, penggabungan part, retry permintaan, penutupan kas, koreksi, backup, foto, dan migrasi data lama.
- Sebanyak 22 pengujian Undo mencakup pemulihan draft/foto, rollback stok/kas, tenggat, akun/peran, penolakan perubahan terbaru/dependensi baru, pemeriksaan ulang form sebelum rollback, klaim antrean cloud, rebasing revisi foto, audit, kegagalan atomik, dan invalidasi setelah restore. Perubahan nama, buang draft, submit, status, serta sparepart diuji lewat browser dengan data contoh di memori.
- PostgreSQL lokal memeriksa penolakan akses langsung/eskalasi peran, masking modal, revisi konflik, idempotensi batch, graph unit/servis/koreksi/tutup kas, penolakan kas setelah tutup, pagination, recovery sekali pakai, dan policy foto KTP.
- Handler autentikasi diuji terhadap kegagalan status, pembatasan percobaan, token setup, dan kesesuaian hash PIN.
- Input ringkas diuji untuk normalisasi WA, nomor bersama yang tidak boleh diisi otomatis, pemisahan merek/tipe, gabungan keluhan/catatan, pemindahan foto draft, serta penyimpanan tanpa transaksi kas. Pemulihan draft form baru juga diperiksa melalui browser.
- Kode pendek diuji terhadap benturan lokal dan kompatibilitas nomor lama. Alur harga normal/gabungan, riwayat, antrean satu batch, penolakan snapshot lama, rollback kegagalan, serta validasi transisi gabungan di PostgreSQL ikut diuji. Modal dan perpindahan langsung ke Dikerjakan diperiksa lewat browser dengan data contoh di memori.
- Seed diuji di IndexedDB dan PostgreSQL untuk pemuatan ulang, nama dengan kapital/spasi berbeda, pelestarian harga/stok yang diedit, akses peran, permintaan bersamaan, rollback, serta tidak adanya transaksi kas tambahan.
- Sepuluh kategori merek HP sesuai daftar toko tersimpan di barang, backup, dan sinkronisasi; alias Apple/iPhone serta Redmi/POCO/Xiaomi dinormalisasi. Barang lama dengan nama yang jelas dapat dikelompokkan tanpa menulis ulang data; nama ambigu masuk Lainnya. Validasi merek, backup lama, pemulihan, dan larangan perubahan merek oleh Kasir diuji.
- `npm run build` dan `npm run check:functions` lulus.

## Batas penerapan

Migrasi, fungsi server, dan panduan penerapan disiapkan dalam repo. Belum ada migrasi/deploy ke Supabase milik toko. Ikuti [DEPLOYMENT.md](/Users/mac/Workspace/lumen-service/docs/DEPLOYMENT.md) untuk memasang versi server dan frontend yang cocok.

Konflik antarperangkat dan antrean versi lama dipertahankan untuk rekonsiliasi Owner; tidak digabung atau dibuang secara otomatis. Pengujian layanan Supabase yang ter-deploy, upload/download storage sungguhan, instalasi PWA pada Android/iPhone, dan printer thermal fisik tetap perlu dilakukan pada lingkungan sasaran.

Aturan pengakuan laba untuk pekerjaan berjalan, kebijakan biaya garansi, dan penyesuaian biaya transaksi lama tetap perlu disepakati secara operasional sebelum angka dipakai untuk bagi hasil. Perubahan ini memperbaiki kesalahan teridentifikasi, bukan menggantikan penetapan kebijakan akuntansi toko.
