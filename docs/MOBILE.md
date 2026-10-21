# Tampilan aplikasi mobile

Pada lebar di bawah 1024 px, ruang kerja memakai susunan khusus mobile. Beranda, menu akun, ringkasan kas, serta hierarki kartu servis/stok/pelanggan dirancang untuk penggunaan dengan sentuhan. Desktop mulai 1024 px tetap memakai sidebar dan susunan kerja yang lebih rapat.

- Identitas mobile: tema monokrom dengan latar abu-abu terang, permukaan putih, warna dasar hitam/abu-abu, aksen oranye, kartu membulat, serta judul dan informasi utama yang lebih jelas. Tema dan ikon PWA konsisten dengan desktop; panduan warna berada di [THEME.md](THEME.md).
- Navigasi bawah: Beranda, Servis, tombol utama Nota baru, Stok, dan Menu. Kas serta pengelolaan lainnya tersedia melalui Menu sesuai peran.
- Beranda: ringkasan servis, pintasan pelanggan/stok, pengingat yang dapat dibuka, dan antrean berdasarkan pembaruan paling lama. Pintasan status serta restok langsung mengaktifkan filter yang sesuai.
- Nota baru: empat bagian dengan penanda kelengkapan, pilihan yang mudah disentuh, tombol simpan tetap terlihat, dan snackbar di atas area tindakan. Pembukaan awal di mobile tidak memfokuskan input secara otomatis. Tombol utama dapat membuka nota berikutnya setelah submit tanpa menghapus draft yang sedang dikerjakan.
- Detail servis: identitas perangkat dipisahkan dari toolbar WhatsApp/cetak. Sparepart tetap di atas tindakan status. Modal tindakan tetap muncul di tengah.
- Stok/pelanggan: kartu dengan identitas utama di atas serta rincian stok, harga, atau kunjungan di bagian terpisah. Filter dan pencarian tetap memakai data dan aturan yang sama.
- Form memakai ukuran teks 16 px pada mobile, sasaran sentuh utama minimal 44 px, dan jarak untuk safe area. Drawer stok/kas menjadi panel bawah sampai ukuran tablet. Navigasi antarhalaman dimulai dari atas, sementara navigasi kembali dapat memulihkan posisi gulir.

Penyimpanan, hak akses, stok/kas, backup, dan Undo 8 detik tetap memakai lapisan bisnis yang sama. Tombol Jual Cepat mengikuti izin jual: Kasir tetap dapat menjual, Teknisi hanya melihat stok.

QA browser menggunakan database memori terpisah dengan data contoh: pintasan status/restok, pencarian/filter stok, profil pelanggan, ringkasan kas, submit/Undo, nota berikutnya dari dock, dan peran Owner/Kasir/Teknisi. Pemeriksaan ukuran layar meliputi ponsel kecil, ponsel, tablet, serta desktop; kamera, keyboard sistem, dan safe area perangkat fisik tetap mengikuti browser/perangkat yang dipakai.
