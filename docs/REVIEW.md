# Review Lumen Service

Tanggal: 19 Oktober 2026. Review terhadap kode sebelum perbaikan.

Status perbaikan 20 Oktober 2026 tercatat di [IMPLEMENTATION.md](/Users/mac/Workspace/lumen-service/docs/IMPLEMENTATION.md).

## Penilaian

Cakupan fitur sudah relevan untuk operasional konter kecil: servis, DP, piutang, garansi, jual beli unit, retur, sparepart, kas, koreksi, dan backup. Pemisahan modul dan model TypeScript cukup jelas untuk dilanjutkan.

Namun, versi ini belum layak menjadi satu-satunya pencatatan keuangan atau dipakai menulis transaksi dari beberapa perangkat sekaligus. Penghambat utamanya adalah kemungkinan kehilangan perubahan lokal, transaksi parsial, akses cloud yang terlalu luas, dan beberapa kesalahan angka. Prioritas pengembangan sebaiknya menjaga kebenaran data sebelum menambah fitur.

## Ruang lingkup dan bukti

- Membaca routing, autentikasi lokal/cloud, model data, logika transaksi, sinkronisasi, backup, halaman internal/publik, komponen foto/dialog, skema SQL, dan konfigurasi PWA.
- `npm run build` berhasil: pemeriksaan TypeScript dan build Vite lulus. Bundle utama 539,77 kB atau 166,73 kB gzip; ada peringatan ukuran chunk.
- Ke-14 kasus pengujian bawaan berhasil dijalankan dengan mentranspilasi TypeScript dan mengadaptasi `bun:test` ke assertion Node. Ini bukan eksekusi native `bun test`, karena Bun belum terpasang.
- Sepuluh skenario tambahan direproduksi menggunakan fungsi asli dan adaptor penyimpanan/cloud dalam memori. Hasilnya dicantumkan di bawah. Adaptor ini memverifikasi alur kontrol dan perhitungan; bukan pengganti pengujian IndexedDB/PostgreSQL sungguhan.
- Tidak melakukan perubahan pada kode aplikasi, migrasi database, akun pengguna, atau transaksi toko. Tidak menguji Supabase yang sudah ter-deploy, printer fisik, maupun PWA offline pada Android/iPhone.

P1 berarti perlu diperbaiki sebelum pemakaian operasional yang bergantung pada fitur tersebut. P2 berarti penting untuk ketepatan perilaku dan pengembangan berikutnya.

## Temuan P1

### R01 — Hak akses cloud belum dibatasi berdasarkan staf dan peran

Lokasi: [schema.sql:193](/Users/mac/Workspace/lumen-service/docs/supabase/schema.sql:193), [sync.ts:32](/Users/mac/Workspace/lumen-service/src/db/sync.ts:32).

Policy SELECT/INSERT/UPDATE memakai `true` untuk seluruh sesi `authenticated`, termasuk tabel `users`, kas, dan koreksi. Kasir yang memiliki sesi cloud bisa melewati tombol UI dan mengubah role/PIN, membaca modal dan hash PIN staf lain, atau mengubah kas langsung. Status staf aktif dan hubungan akun Supabase dengan staf juga tidak diperiksa oleh policy. Audit append-only belum menjamin identitas pencatat, karena nilai `user_id` dan isi catatan dikirim dari klien.

Saran: hubungkan staf dengan ID Supabase Auth yang tidak dapat diubah klien; tegakkan peran dan status aktif di server. Pisahkan profil staf dari hash PIN/recovery agar kredensial tidak tersinkron ke semua perangkat. Perubahan kas, approval, dan audit sebaiknya melalui operasi server yang memeriksa kewenangan serta menentukan aktor sendiri. Uji akses yang diizinkan dan ditolak untuk setiap peran. Dasar teknis: [dokumentasi RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

### R02 — Kegagalan query status cloud bisa menghapus seluruh cache lokal

Lokasi: [auth/index.ts:103](/Users/mac/Workspace/lumen-service/supabase/functions/auth/index.ts:103), [cloud-boot.tsx:31](/Users/mac/Workspace/lumen-service/src/pages/auth/cloud-boot.tsx:31), [sync.ts:437](/Users/mac/Workspace/lumen-service/src/db/sync.ts:437).

Endpoint `status` mengabaikan `error` dari query jumlah pengguna. Jika query gagal dan `count` null, respons tetap `{ok:true, hasUsers:false}`. CloudBoot menafsirkannya sebagai toko kosong dan menghapus semua tabel lokal, termasuk foto dan antrean transaksi offline. Respons keliru ini berhasil direproduksi dengan kegagalan query yang disimulasikan.

Saran: kembalikan error bila query gagal. Bedakan keadaan kosong yang terverifikasi dari keadaan tidak diketahui. Reset cloud jangan otomatis memusnahkan data lokal yang belum terkirim; sediakan penyelamatan/backup dan proses pergantian identitas toko yang eksplisit.

### R03 — Antrean di atas 2.000 perubahan dibuang sebelum dikirim

Lokasi: [sync.ts:509](/Users/mac/Workspace/lumen-service/src/db/sync.ts:509).

Antrean offline besar dianggap abnormal lalu dihapus. Simulasi 2.001 entri menghasilkan antrean kosong dengan nol panggilan push. Transaksi yang baru dibuat secara offline mungkin belum pernah ada di cloud; membuang antreannya memutus satu-satunya jalur pengirimannya. Pull berikutnya juga dapat mengganti baris lokal yang lebih baru.

Saran: pertahankan setiap perubahan sampai server mengakui penerimaannya. Jika antrean membesar, deduplikasi secara aman, kirim per batch, batasi retry, dan tampilkan masalahnya. Jangan gunakan penghapusan antrean sebagai pemulihan otomatis.

### R04 — Pull menimpa perubahan lokal meskipun push gagal

Lokasi: [sync.ts:394](/Users/mac/Workspace/lumen-service/src/db/sync.ts:394), [sync.ts:418](/Users/mac/Workspace/lumen-service/src/db/sync.ts:418), [sync.ts:520](/Users/mac/Workspace/lumen-service/src/db/sync.ts:520).

Setelah push gagal, engine tetap menarik semua tabel dan melakukan `bulkPut`. Contoh simulasi: stok lokal 5 sedang menunggu pengiriman, stok server 9; push ditolak, lalu lokal menjadi 9 sementara antreannya masih ada. Retry berikutnya membaca nilai lokal yang sudah tertimpa, sehingga perubahan asli tidak dapat dipulihkan dari antrean yang hanya menyimpan key.

Saran: jangan menimpa baris yang masih memiliki perubahan tertunda. Simpan payload operasi dan versi dasar dalam antrean, gunakan versi record untuk deteksi konflik, dan tentukan penyelesaian konflik per operasi. Hindari upsert seluruh baris untuk aksi keuangan atau perubahan stok yang harus digabungkan secara aman.

### R05 — Transaksi bisnis belum disimpan sebagai satu kesatuan

Lokasi: [units.ts:85](/Users/mac/Workspace/lumen-service/src/db/units.ts:85), [tickets.ts:146](/Users/mac/Workspace/lumen-service/src/db/tickets.ts:146), [stok/list.tsx:252](/Users/mac/Workspace/lumen-service/src/pages/stok/list.tsx:252), [koreksi.tsx:24](/Users/mac/Workspace/lumen-service/src/pages/koreksi.tsx:24).

Penjualan unit mengubah status terlebih dahulu, baru mencatat kas dan audit. Pembelian, pembayaran servis/piutang, penjualan part, restok, approval koreksi, dan tutup kas juga memiliki beberapa penulisan terpisah. Kegagalan salah satu langkah membuat status, stok, kas, atau audit tidak cocok. Dengan menyimulasikan kegagalan pencatatan kas, unit tetap `terjual` tanpa entri penerimaan uang.

Saran: jadikan satu aksi bisnis satu transaksi IndexedDB, mencakup tabel entitas, stok, kas, audit, dan outbox yang diperlukan. Untuk cloud, terapkan aksi tersebut dalam transaksi PostgreSQL/RPC. Kegagalan harus membatalkan keseluruhan aksi, dan retry tidak boleh menggandakan transaksi. Dexie mendukung operasi terkait dalam satu transaksi: [dokumentasi transaksi](https://dexie.org/docs/Dexie/Dexie.transaction%28%29).

### R06 — Aksi dari dua tab/perangkat dapat menggandakan transaksi atau menghilangkan rincian

Lokasi: [units.ts:85](/Users/mac/Workspace/lumen-service/src/db/units.ts:85), [tickets.ts:320](/Users/mac/Workspace/lumen-service/src/db/tickets.ts:320), [settings.ts:52](/Users/mac/Workspace/lumen-service/src/db/settings.ts:52).

Fungsi penjualan tidak membaca ulang status unit atau menolak operasi yang sudah selesai. Dua pemanggilan menggunakan snapshot unit yang sama membuat dua penerimaan kas. Pemakaian part membaca stok terbaru tetapi menulis `partsUsed` dari snapshot tiket lama: dua pemakaian mengurangi stok dua, sementara tiket hanya merekam satu. Penghitung nomor nota juga lokal per perangkat; dua perangkat offline dengan penghitung sama menghasilkan nomor sama dan dapat tertolak oleh constraint unik di cloud.

Saran: baca ulang entitas dalam transaksi, periksa transisi status/versi, dan beri setiap aksi ID yang menjamin pengiriman ulang diterapkan sekali. Penjualan unit perlu penguncian/pengecekan atomik di server. Gunakan nomor nota yang tetap unik saat offline, misalnya alokasi nomor per perangkat atau awalan perangkat yang jelas. Selesaikan desain ini sebelum mengaktifkan penulisan dari banyak perangkat.

### R07 — Refund DP tidak mengurangi pendapatan dan laba servis

Lokasi: [money.ts:86](/Users/mac/Workspace/lumen-service/src/db/money.ts:86), [tickets.ts:175](/Users/mac/Workspace/lumen-service/src/db/tickets.ts:175).

Pembatalan dengan refund menambahkan kas keluar kategori `servis`, tetapi `servisIn` hanya menjumlahkan kas masuk kategori tersebut. DP Rp100.000 yang dikembalikan penuh masih menghasilkan pendapatan dan laba servis Rp100.000. Total arus kas benar, sehingga kesalahan bisa tidak terlihat tanpa membandingkan laporan laba.

Saran: masukkan refund sebagai pengurang pendapatan servis pada periode refund. Tambahkan pengujian DP yang hangus, refund penuh, dan refund lintas bulan. Pisahkan dengan jelas kebijakan pengakuan pendapatan, piutang, dan biaya sparepart.

### R08 — Backup yang tidak lengkap bisa diterima lalu mengosongkan data

Lokasi: [pengaturan.tsx:513](/Users/mac/Workspace/lumen-service/src/pages/pengaturan.tsx:513), [pengaturan.tsx:565](/Users/mac/Workspace/lumen-service/src/pages/pengaturan.tsx:565).

Pemeriksaan awal hanya memastikan `app` cocok. JSON berisi hanya `{"app":"lumen-service"}` lolos; properti tabel yang hilang dianggap array kosong, lalu seluruh data lama dibersihkan dan diganti. Tidak ada validasi versi, bentuk record, relasi, atau kelengkapan backup sebelum operasi penggantian. Pada mode cloud, proses restore juga tidak mengatur rekonsiliasi data server: baris lama di server dapat muncul kembali saat pull.

Saran: validasi keseluruhan isi dan versi setelah dekripsi, tampilkan jumlah data yang akan dipulihkan, dan tolak file tidak lengkap. Simpan salinan sebelum penggantian. Pisahkan restore lokal dari restore cloud, hentikan sinkronisasi selama proses, dan tentukan apakah pemulihan cloud berarti penggabungan atau penggantian. Ekspor juga sebaiknya membaca tabel dalam satu snapshot transaksi agar backup konsisten.

## Temuan P2

### R09 — Biaya jasa final nol selalu kembali ke estimasi

Lokasi: [money.ts:20](/Users/mac/Workspace/lumen-service/src/db/money.ts:20), [servis/detail.tsx:107](/Users/mac/Workspace/lumen-service/src/pages/servis/detail.tsx:107).

`biayaJasa || estimasi` menyamakan harga final nol dengan harga yang belum ditentukan. Estimasi Rp100.000 yang direvisi menjadi gratis tetap dihitung Rp100.000. Gunakan nilai nullable atau penanda harga final yang eksplisit; nol harus tetap menjadi angka yang sah. Terapkan aturan sama pada total, rincian, nota, dan pesan WA.

### R10 — Nota WhatsApp tetap menampilkan sisa setelah pelanggan lunas

Lokasi: [nota.tsx:113](/Users/mac/Workspace/lumen-service/src/pages/servis/nota.tsx:113), [money.ts:26](/Users/mac/Workspace/lumen-service/src/db/money.ts:26).

Pesan WA selalu menggunakan `total - dp`; pembayaran saat pengambilan dan pembayaran piutang tidak ikut diperhitungkan. Contoh total Rp100.000, DP Rp20.000, pelunasan Rp80.000, piutang nol: pesan masih menyebut sisa Rp80.000. Nota cetak sudah menyembunyikan SISA saat `diambil`, sehingga kedua keluaran juga tidak konsisten.

Saran: bedakan sisa sebelum pengambilan dari piutang berjalan; untuk tiket diambil tampilkan LUNAS atau piutang aktual. Untuk ketepatan setelah jurnal koreksi, hitung pembayaran dari jurnal tertaut dan rekonsiliasikan saldo tiket.

### R11 — Alur autentikasi cloud, offline, dan recovery belum selaras

Lokasi: [login.tsx:44](/Users/mac/Workspace/lumen-service/src/pages/auth/login.tsx:44), [login.tsx:170](/Users/mac/Workspace/lumen-service/src/pages/auth/login.tsx:170), [session.tsx:94](/Users/mac/Workspace/lumen-service/src/auth/session.tsx:94).

Login pada mode cloud selalu memanggil server; ketika koneksi putus, pengguna yang sudah logout/terkunci otomatis tidak memperoleh fallback login lokal. Pemulihan PIN hanya membaca/mengubah IndexedDB, sehingga perangkat baru tanpa cache pengguna tidak bisa memakai kode pemulihan cloud. Logout dan kunci otomatis hanya menghapus sesi aplikasi, sementara sesi Supabase tetap tersimpan.

Saran: definisikan kebijakan akses offline dan masa berlakunya, buat recovery sekali pakai di server, dan selaraskan lifecycle sesi aplikasi dengan Supabase. Jangan memperbaiki fallback offline dengan menyebarkan seluruh hash PIN pengguna. Uji perangkat baru, sesi kedaluwarsa, logout, PIN berubah, staf nonaktif, dan perpindahan staf pada perangkat bersama.

### R12 — Pengambilan data cloud belum memakai pagination

Lokasi: [sync.ts:407](/Users/mac/Workspace/lumen-service/src/db/sync.ts:407).

Pull menggunakan satu `select('*')` per tabel. Ketika data melewati batas respons API, perangkat baru hanya mendapat sebagian data; laporan dan saldo dari cache dapat salah meskipun permintaan sukses. Batas default yang didokumentasikan Supabase adalah 1.000 baris, dan dapat diatur per proyek: [referensi Supabase](https://supabase.com/docs/reference/javascript/v1/select).

Saran: tarik seluruh halaman dengan urutan stabil, lalu gunakan cursor perubahan agar tidak membaca semua tabel setiap 30 detik. Uji bootstrap dengan lebih dari satu halaman data. Audit yang memang dibatasi 1.000 record perlu jalur pencarian/riwayat terpisah; halaman audit lokal sekarang hanya menampilkan 300 terbaru.

### R13 — Status dapat menyebut tersinkron meskipun pull gagal

Lokasi: [sync.ts:414](/Users/mac/Workspace/lumen-service/src/db/sync.ts:414), [sync.ts:521](/Users/mac/Workspace/lumen-service/src/db/sync.ts:521).

Error pull hanya dicatat ke console; tidak memengaruhi hasil `ok` pada tick. Saat semua pull gagal dan antrean kosong, simulasi tetap menghasilkan state `idle`, yang di UI diterjemahkan menjadi Tersinkron. Saran: teruskan kegagalan pull ke status, bedakan waktu percobaan dengan waktu sinkron berhasil, dan beri pengguna cara mengulangi serta melihat penyebab kegagalan.

### R14 — Foto belum ikut cloud, sementara indikator sinkron hanya mencakup data tabel

Lokasi: [sync.ts:296](/Users/mac/Workspace/lumen-service/src/db/sync.ts:296), [photos.tsx:88](/Users/mac/Workspace/lumen-service/src/components/photos.tsx:88).

Foto kondisi, foto unit, dan KTP hanya disimpan sebagai Blob lokal; `photos` tidak ada pada registry sinkronisasi. Owner yang membuka perangkat lain tidak menerima bukti foto meskipun data tiket/unit tersinkron. Tidak ada implementasi upload Storage maupun policy bucket dalam repo.

Saran: antrekan upload foto secara terpisah, gunakan bucket privat dan akses sesuai peran, serta tunjukkan jumlah foto yang belum berhasil dicadangkan. Penghapusan foto bukti juga perlu aturan dan jejak audit; saat ini penghapusan foto langsung dilakukan di IndexedDB.

### R15 — Login PIN server belum memiliki pembatasan percobaan dalam kode

Lokasi: [auth/index.ts:170](/Users/mac/Workspace/lumen-service/supabase/functions/auth/index.ts:170).

Endpoint menerima percobaan PIN berulang tanpa counter, jeda, atau penguncian per akun/IP pada implementasi repo. PBKDF2 membantu biaya hashing, tetapi tidak menggantikan pembatasan percobaan terhadap PIN 4–6 digit. Validasi panjang/format PIN dan username juga perlu dilakukan di server, bukan hanya form.

Saran: tambahkan pembatasan percobaan, penundaan bertahap, dan pencatatan kegagalan tanpa merekam PIN. Periksa apakah deployment memiliki gateway pelindung tambahan; hal itu belum diverifikasi di review ini. Setup awal juga perlu dikunci sebagai proses bootstrap server agar dua request tidak bisa bersamaan membuat dua pasangan akun.

### R16 — Batas akses peran masih bocor pada beberapa halaman biasa

Lokasi: [beranda.tsx:110](/Users/mac/Workspace/lumen-service/src/pages/beranda.tsx:110), [pengaturan.tsx:35](/Users/mac/Workspace/lumen-service/src/pages/pengaturan.tsx:35), [app-shell.tsx:53](/Users/mac/Workspace/lumen-service/src/components/layout/app-shell.tsx:53).

Beranda menampilkan total modal stok berumur >60 hari tanpa `canSeeMoney`, sehingga Kasir/Teknisi dapat melihatnya. Semua peran juga mendapat halaman Kas dan dapat mengubah profil toko/template WA; perlu diputuskan apakah itu kewenangan yang diinginkan. Saat ini definisi izin terutama berupa satu fungsi `canSeeMoney`, belum matriks tindakan per peran.

Saran: tetapkan izin untuk melihat data, menjual, membatalkan, mengubah harga, mencatat prive, tutup kas, mengelola profil, dan mengelola staf. Terapkan di UI, lapisan operasi, dan server. Penyesuaian UI membantu penggunaan; kewenangan server tetap wajib ditangani melalui R01.

## Risiko dan kekurangan lain yang perlu direncanakan

- **View publik:** `public_ticket_status` mengekspos seluruh riwayat, termasuk field penulis/catatan yang juga dipakai untuk informasi internal. View dibuat tanpa `security_invoker` dan tanpa REVOKE eksplisit. Jika deployment masih memberi grants default kepada anon, komentar "diaktifkan nanti" tidak melindungi view dari akses langsung. Verifikasi grants nyata; gunakan endpoint pencarian yang hanya mengembalikan satu hasil dengan field aman. Supabase menjelaskan [view melewati RLS secara default](https://supabase.com/docs/guides/database/postgres/row-level-security#views-and-rls). Review ini tidak membuktikan eksposur pada deployment tertentu.
- **Web publik:** katalog, profil, dan cek servis membaca IndexedDB browser pengunjung. Pelanggan pada perangkat baru tidak memperoleh stok/status toko. Banner "Segera aktif" sudah jujur, tetapi teks landing masih menjanjikan cek status kapan saja. Hubungkan API publik setelah batas data dan hak aksesnya selesai.
- **Pengakuan biaya:** modal part baru dibebankan saat tiket `diambil`. Part pada servis batal dan garansi yang sudah dikonsumsi perlu kebijakan eksplisit. Harga modal restok tidak dihitung ulang dari biaya pembelian; stok awal bisa ditambah tanpa pencatatan pembelian. Jangan memakai laba untuk bagi hasil sebelum skenario ini diuji dan definisinya disepakati.
- **Validasi:** pembelian menerima IMEI dengan panjang >=14, sedangkan pemeriksaan 15 digit hanya memberi peringatan. Foto KTP disebut wajib tetapi tidak termasuk syarat `valid`; foto penerimaan servis juga opsional. Selaraskan teks form dengan kebijakan nyata dan tambahkan validasi di lapisan operasi/database, termasuk angka nonnegatif dan jumlah part positif.
- **Outbox:** capture perubahan ditunda lewat timer di luar transaksi data utama. Penutupan aplikasi sebelum flush dapat meninggalkan data tanpa antrean. Flag global `applyDepth` juga menekan semua capture selama penerapan remote, bukan hanya record remote; tulisan lokal yang beririsan berpotensi terlewat. Gunakan outbox dalam transaksi yang sama dan konteks asal penulisan yang spesifik.
- **Audit:** profil toko, template WA, dan foto tidak selalu menghasilkan audit. Catatan append-only yang dikirim klien belum memenuhi janji integritas dua arah. Jurnal koreksi kas juga tidak otomatis merekonsiliasi DP/piutang/status sumbernya.
- **Pengalaman penggunaan:** detail dengan ID tidak ditemukan menampilkan layar kosong; banyak event async hanya memakai `finally` tanpa pesan error. Dialog belum mengelola fokus keyboard dan pengembalian fokus. Form pembelian unit belum punya penyimpanan draft seperti servis.
- **Skala dan perangkat:** daftar/dashboard banyak memuat seluruh tabel. Gunakan pagination/index sesuai kebutuhan. Tanggal bisnis mengikuti zona waktu perangkat; tentukan zona toko agar laporan owner dari lokasi berbeda konsisten.
- **PWA:** build service worker berhasil, tetapi install, offline setelah restart, upgrade versi dengan data lama, dan cetak perlu diuji pada perangkat sasaran. Pisahkan route dengan lazy loading setelah masalah data dibereskan; ukuran bundle sekarang bukan masalah paling mendesak.
- **Pemeliharaan:** logika bisnis stok, koreksi, backup, dan tutup kas masih tersebar di halaman. Pindahkan ke lapisan operasi agar validasi/transaksi konsisten. Tambahkan pemeriksaan otomatis build, test, dan migrasi. README dan komentar SQL masih menggambarkan tahap integrasi/auth yang berbeda dari kode sekarang; dokumentasikan mode lokal dan cloud beserta batasannya.

## Hasil reproduksi tambahan

Semua angka berikut berasal dari fungsi sumber yang dijalankan dengan input sintetis. Tidak memakai data atau kredensial toko.

| Skenario | Hasil aktual | Hasil yang diharapkan |
|---|---|---|
| Estimasi 100.000, jasa final 0 | Total 100.000 | Total 0 |
| DP 100.000, refund penuh | Pendapatan servis 100.000 | Pendapatan servis neto 0 |
| Sudah lunas: total 100.000, DP 20.000 | Perhitungan yang dipakai WA menyebut sisa 80.000 | Sisa 0 |
| Penulisan kas gagal saat jual unit | Unit terjual, tidak ada kas masuk | Seluruh operasi dibatalkan |
| Jual unit dua kali dari snapshot sama | Dua kas masuk | Satu penjualan diterapkan |
| Dua pemakaian part dari snapshot tiket sama | Stok berkurang 2, tiket merekam 1 | Keduanya merekam 2 |
| Push stok lokal 5 ditolak, remote 9 ditarik | Lokal menjadi 9; antrean masih 1 | Perubahan lokal tetap dipertahankan |
| Antrean berisi 2.001 perubahan | Antrean kosong; tidak ada push | Antrean dikirim atau tetap disimpan |
| Semua pull gagal, antrean kosong | Status `idle` / Tersinkron | Status kegagalan |
| Query status pengguna cloud error | `ok:true, hasUsers:false` | Error; cache lokal dipertahankan |

## Urutan perbaikan yang disarankan

1. **Lindungi data yang sudah dibuat:** R02–R04 dan R08; hapus perilaku membuang antrean/cache pada error, perbaiki restore, dan tambahkan uji kegagalan.
2. **Pastikan angka dan transaksi konsisten:** R05–R07, R09–R10; transaksi atomik, pemeriksaan status terbaru, ID operasi, refund dan saldo yang benar.
3. **Tutup akses cloud:** R01, R11, R15–R16; pemetaan staf–Auth, policy per peran, pemisahan kredensial, recovery dan sesi yang konsisten. Lakukan ini sebelum cloud menyimpan data sensitif.
4. **Selesaikan penggunaan lintas perangkat:** R12–R14; pagination, konflik, nomor nota unik offline, status sinkron yang jujur, dan upload foto. Sebelum itu, batasi penulisan operasional pada satu perangkat utama.
5. **Lengkapi rilis:** API publik, pengecekan perangkat/printer, penanganan error, dokumentasi, serta otomatisasi pengujian.

Uji penerimaan minimum setelah perbaikan: koneksi terputus saat menyimpan, aplikasi ditutup sebelum sync, push ditolak, data lebih dari 1.000 record, dua tab menjual unit yang sama, nomor nota offline dari dua perangkat, refund lintas bulan, lunas setelah piutang, restore file tidak lengkap, login/recovery di perangkat baru, dan percobaan aksi Owner oleh Kasir.
