# Snackbar dan Undo nota servis

Form nota baru menampilkan status setelah perubahan draft tersimpan (600 ms setelah berhenti mengetik, atau saat pindah isian). Pilihan pelanggan, keluhan, kelengkapan, foto, buang draft, dan simpan nota mempunyai tombol **Undo selama 8 detik**. Undo simpan nota mengembalikan isian dan foto ke draft. Tombol nota berikutnya memulai draft baru sehingga Undo dari nota sebelumnya tidak menimpa pekerjaan baru.

Pada detail nota, Undo tersedia untuk edit data, status, pengajuan/revisi harga, pemakaian/penghapusan sparepart, pembatalan servis, pengambilan/pembayaran piutang, foto, dan pembuatan nota garansi. Undo sparepart mengembalikan stok; Undo pembayaran mengembalikan status/piutang dan transaksi kas dalam satu transaksi. Snackbar berhasil baru muncul setelah penyimpanan/pembatalan selesai. Cetak dan WhatsApp tidak mempunyai Undo karena keduanya merupakan tindakan di luar perubahan data nota.

Undo hanya berlaku untuk staf yang melakukan tindakan dengan akun aktif dan peran yang sama. Bila data sudah berubah lagi, foto draft baru ditambahkan, nota/profil baru sudah dipakai tindakan lain, kas dikunci/ditutup, atau pengiriman cloud sudah dimulai, pembatalan ditolak dengan penjelasan. Batalkan perubahan paling baru terlebih dahulu. Setelah 8 detik, gunakan alur revisi/koreksi yang sesuai.

Data langsung tersimpan di perangkat. Dalam mode cloud, satu batch transaksi ditahan hingga tenggat Undo berakhir. Undo mengembalikan data lokal dan membatalkan antrean bisnis yang belum terkirim; audit tindakan asli tetap disimpan, disertai audit pembatalannya. Pengirim mengklaim batch secara atomik sebelum upload/RPC agar tidak berlomba dengan Undo, termasuk pada browser tanpa Web Locks. Menutup snackbar atau aplikasi tidak membatalkan transaksi secara otomatis.

IndexedDB versi 7 menambah tabel sementara `undoReceipts`. Salinan Undo kedaluwarsa dibersihkan setelah tenggat, saat aplikasi dibuka, dan sebelum tindakan berikutnya. Salinan ini tidak ikut backup; pemulihan backup menghapus salinan Undo sebelumnya. Perubahan ini tidak memerlukan migrasi SQL tambahan, di luar migrasi pelanggan yang telah disiapkan pada fitur sebelumnya.
