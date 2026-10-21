# Koreksi pembelian sparepart

Owner dan Head Operasional dapat langsung menerapkan koreksi pembelian. Tidak ada tahap menunggu persetujuan Owner. Stok, modal rata-rata, kas, riwayat koreksi, dan audit disimpan dalam satu transaksi lokal dan satu transaksi server.

## Cara menggunakan

1. Dari Stok, buka barang lalu pilih **Riwayat / Koreksi Pembelian**. Alternatifnya, tekan tombol koreksi pada transaksi pembelian di halaman Kas.
2. Pilih transaksi asal. Pembelian tunai yang belum tersinkron harus menyelesaikan sinkronisasinya terlebih dahulu.
3. Pilih **Salah pencatatan pembelian** atau **Pengembalian uang supplier**.
4. Masukkan jumlah yang benar, total biaya seluruh barang, dan alasan. Untuk pengembalian supplier, pilih juga metode uang dikembalikan.
5. Pilih **Periksa Perubahan**. Periksa jumlah pembelian, stok tersedia, modal rata-rata per pcs, dan dampak kas.
6. Pilih **Terapkan Koreksi**. Aplikasi mencatat tindakan sebagai langsung diterapkan oleh pengguna tersebut.

Pengajuan koreksi kas lama pada pembelian yang sama ditandai ditolak/digantikan dalam transaksi yang sama; pengajuan aslinya tetap disimpan. Koreksi pembelian baru merekam alasan, nilai sebelum/sesudah, pemohon, pelaksana, dan waktu.

## Dampak per jenis

**Salah pencatatan** memperbaiki nominal pengeluaran transaksi asal. Contoh empat barang sebenarnya dibeli Rp300.000, tetapi dicatat Rp400.000: pengeluaran menjadi Rp300.000 dan modal menjadi Rp75.000/pcs bila tidak ada persediaan sebelumnya. Jumlah yang dikoreksi juga mengubah stok sebesar selisih pembeliannya.

**Pengembalian supplier** mempertahankan nominal pengeluaran asal dan membuat kas masuk baru. Pembayaran Rp400.000 dengan pengembalian Rp100.000 menghasilkan biaya bersih Rp300.000. Jumlah barang tetap, modal dihitung dari biaya bersih, dan metode pengembalian menentukan apakah uang tunai di laci ikut berubah. Pengiriman ulang batch server tidak menggandakan pengembalian.

Untuk restok terbaru yang masih dapat dikoreksi, modal dihitung dari `(stok sebelum × modal sebelum + total biaya benar) ÷ stok setelah`, dibulatkan ke rupiah. Modal penjualan atau part servis yang sudah dipakai tidak dihitung ulang secara diam-diam.

## Pemeriksaan sebelum menerapkan

- Peran diperiksa ulang dari akun aktif di transaksi, bukan hanya tombol UI. Kasir dan Teknisi tidak dapat mengoreksi pembelian.
- Data pembelian, stok, dan nominal yang ditampilkan harus masih sama saat disimpan. Server memeriksa revisi seluruh baris sebelum mengubah apa pun.
- Pembelian baru hanya dapat dikoreksi ketika snapshot stok/modal dan revisi barang masih sesuai. Pemakaian, penjualan, restok lain, opname, atau perubahan rincian berikutnya dapat memerlukan rekonsiliasi terpisah.
- Pembelian lama tanpa snapshot hanya dapat direkonsiliasi bila barang belum dipakai/dijual dan hanya memiliki satu transaksi pembelian. Jumlah yang dimasukkan menjadi jumlah stok akhirnya; nota supplier harus dicocokkan terlebih dahulu. Ini juga mendukung kasus kas sudah dikoreksi tetapi modal stok masih lama.
- Kas pembelian yang sudah ditutup tidak diubah melalui alur ini. Koreksi pengembalian supplier yang sudah salah dicatat juga memerlukan rekonsiliasi terpisah.
- Modal di form katalog barang terkunci. Menyimpan nama, merek, atau harga jual tidak dapat mengembalikan modal lama dari form yang sudah tertinggal.
- Penyesuaian fisik tetap hanya mengubah jumlah stok. Restok berbiaya nol tidak menciptakan kas keluar.

## Server dan pemulihan

Jalankan migrasi `202610210002_purchase_corrections.sql` sebelum frontend baru. Tidak ada data bisnis lama yang dihapus atau dikoreksi otomatis. Skema instalasi baru juga menyertakan migrasi ini.

Snapshot pembelian disimpan dalam metadata transaksi kas; rincian perubahan disimpan dalam JSON jurnal koreksi. Keduanya ikut sinkronisasi dan backup versi 4. Validasi backup menolak snapshot pembelian yang rusak sebelum pemulihan.

Validasi server menghitung ulang hasil, memeriksa sumber kas, stok, batas refund, status kas, permintaan lama, dan peran pelaksana. Pengecualian HO tidak mengizinkan koreksi kas umum tanpa Owner atau perubahan referensi transaksi.
