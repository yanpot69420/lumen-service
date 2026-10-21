# Tema ruang kerja

Desktop dan mobile memakai identitas yang sama: monokrom dengan aksen oranye. Warna dasar gelap `#171717` dipakai untuk judul dan tindakan utama, latar abu-abu terang `#f5f5f5`, permukaan putih, serta aksen oranye `#f97316` dengan teks gelap. Token warna bersama berada di `src/index.css`; tanda merek bersama berada di `src/components/brand.tsx`. Warna status semantik tetap membedakan sukses, peringatan, dan kesalahan.

Di bawah 1024 px, aplikasi mempertahankan navigasi bawah, kartu operasional, serta kontrol sentuh mobile. Mulai 1024 px, sidebar putih menampilkan kelompok Operasional dan Pengelolaan, tombol Buat nota servis, status sinkronisasi, dan akun. Konten dibatasi hingga 1320 px agar baris tetap mudah dibaca pada monitor besar.

- Beranda desktop menampilkan ringkasan, pintasan status, antrean yang paling lama diperbarui, dan pengingat yang dapat dibuka. Angka keuangan mengikuti hak akses.
- Daftar servis, stok, pelanggan, serta jurnal kas memakai kolom dan toolbar yang lebih jelas pada desktop. Pencarian dan filter tetap memakai aturan yang sama.
- Detail servis memakai dua kolom pada layar lebar; sparepart tetap di atas tindakan. Form nota menampilkan empat bagian dengan penanda langkah. Modal tindakan tetap di tengah.
- Profil pelanggan, kas, laporan, menu akun, dan login memakai hierarki serta komponen tema yang sama. Nominal besar dapat membungkus agar tidak terpotong.
- Input, kartu, tombol, fokus keyboard, dan modal memakai gaya bersama. Preferensi pengurangan animasi tetap dihormati.

Landing page juga memakai tema yang sama: navigasi publik dengan sasaran sentuh yang lapang, pembuka dengan ilustrasi perangkat, kartu layanan, panduan cek servis, katalog pilihan, informasi konter, dan FAQ. Ilustrasi bersifat dekoratif, tanpa data pelanggan sungguhan. Katalog membedakan proses memuat, kosong, dan gagal dimuat; kartu menampilkan garansi hanya bila tercatat pada produk. WhatsApp hanya ditampilkan saat nomor toko tersedia. Navigasi/footer publik juga dipakai halaman katalog dan cek servis.

Warna bilah browser, banner pembaruan, favicon, dan ikon instalasi PWA mengikuti tema monokrom-oranye. Pembaruan ini tidak mengubah database, perhitungan, transaksi, izin, sinkronisasi, maupun Undo.

Verifikasi terbaru: pemeriksaan TypeScript dan build produksi lulus; 145 pengujian dengan 688 pemeriksaan lulus. Tautan filter, pembatasan peran, susunan pada batas 1024 px, serta handler diperiksa dari kode. Pratinjau visual browser untuk pembaruan ini belum dapat diperiksa karena kebijakan lingkungan menolak akses browser. Rincian pengujian bisnis ada di [PREFLIGHT.md](PREFLIGHT.md).
