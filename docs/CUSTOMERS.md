# Pendataan pelanggan

Buka **Pelanggan** pada sidebar desktop atau **Lainnya → Pelanggan** di HP.

## Profil dan langganan

- Owner, Head Operasional, dan Kasir dapat menambah atau mengedit profil.
- Nama wajib diisi; nomor WA opsional. Catatan internal dan penanda **Pelanggan langganan** dapat diubah sesuai pelayanan toko.
- Teknisi dapat membaca profil serta membuat nota; penambahan profil dari nota teknisi hanya membuat identitas dasar, tanpa catatan atau status langganan.
- Pencarian mendukung nama/WA; filter Langganan menampilkan pelanggan yang ditandai manual. Tidak ada diskon atau poin otomatis.

Nomor 08…, 8…, dan +62… dicocokkan dalam bentuk yang sama. Profil dengan nama serta WA sama ditolak sebagai duplikat. Nomor bersama untuk anggota keluarga diperbolehkan jika nama berbeda. Nama sama dengan nomor kosong tidak digabung otomatis; pilih profil yang tepat saat membuat nota berikutnya.

## Nota dan riwayat

Tombol **Buat Nota** pada profil mengisi identitas pelanggan di form penerimaan. Pencarian pelanggan di form nota juga memakai profil tersimpan dan riwayat lama yang belum memiliki profil. Nota baru menyimpan hubungan ke profil; pelanggan baru dari nota dibuat secara atomik bersama nota dan bukti fotonya.

Riwayat menampilkan perangkat, keluhan, tanggal, harga, status, dan tautan detail nota. Nama/WA pada nota adalah salinan saat nota dibuat. Mengedit profil tidak mengubah nota yang sudah tersimpan, dan relasi nota yang sudah dibuat tidak dapat dialihkan ke pelanggan lain. Klaim garansi tetap memakai profil pelanggan yang sama.

Nota lama tanpa hubungan profil hanya ditampilkan jika nomor WA tidak kosong, nama cocok, dan identitas tersebut hanya dimiliki satu profil tersimpan. Nota dengan identitas ambigu tidak digabung otomatis. Mengubah identitas profil dapat mengubah hasil pencocokan nota lama yang belum tertaut; nota baru yang sudah tertaut tetap mengikuti ID profil.

Saat membuka nota dari profil lain sementara ada draft, aplikasi meminta memilih melanjutkan draft atau membuang isian/foto draft sebelum memulai nota baru. Data dari dua pelanggan tidak dicampur otomatis.

## Backup dan cloud

Backup versi **4** memuat pelanggan serta hubungan nota. Restore memeriksa tipe data, identitas duplikat, dan referensi sebelum mengubah database. Backup 1–3 yang tidak memiliki tabel pelanggan dibaca dengan daftar pelanggan kosong; data lama tidak otomatis ditulis ulang. Snapshot pengaman lama juga tetap dapat diunduh.

Pasang [202610200007_customers.sql](/Users/mac/Workspace/lumen-service/supabase/migrations/202610200007_customers.sql) sebelum merilis frontend pelanggan di Supabase. Migrasi hanya menambah tabel/relasi dan memperbarui RPC. Tidak ada akun, nota, foto, stok, atau kas yang dihapus. Pelanggan tidak tersedia pada API publik.

Semua perangkat harus menggunakan frontend yang cocok. Klien lama yang tidak mengirim hubungan pelanggan saat mengubah nota tertaut akan ditolak server. Dua perangkat yang membuat pelanggan identik ketika offline dapat mengalami konflik identitas saat sinkronisasi; antrean, nota, dan bukti tetap disimpan untuk rekonsiliasi Owner. Hindari membuat ulang profil jika profil yang sama sudah tersedia.
