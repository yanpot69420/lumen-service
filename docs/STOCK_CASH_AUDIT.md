# Audit alur stok sparepart dan kas — 21 Oktober 2026

Pemeriksaan mencakup fungsi transaksi lokal, langganan perubahan yang dipakai halaman Kas, izin Head Operasional dan Owner di PostgreSQL, serta pembacaan stok, jurnal kas, jurnal koreksi, dan audit pada deployment. Tidak ada transaksi percobaan atau perubahan data bisnis pada production.

## Temuan

1. **Harga beli stok dan pengeluaran kas memiliki satuan berbeda.** Stok menyimpan modal rata-rata per pcs; kas menyimpan total pembayaran. Pembelian awal mengeluarkan jumlah × modal per pcs. Restok berbayar mencatat total pembelian dan menghitung ulang rata-rata tertimbang.
2. **Penyesuaian fisik tidak membuat transaksi kas.** Fungsi `adjustPart` hanya mengubah jumlah stok dan mencatat audit. Penemuan barang lama atau selisih hitung tidak membuktikan adanya pembayaran baru. Restok dengan biaya nol juga tidak membuat kas keluar.
3. **Koreksi kas dan modal stok merupakan dua proses terpisah.** Persetujuan koreksi mengubah nominal kas, tetapi tidak menghitung ulang `parts.hargaModal`. Sebaliknya, mengedit modal katalog tidak mengubah jurnal pembelian lama. Ini menjelaskan kemungkinan stok × modal berbeda dari pengeluaran setelah koreksi input awal. Menghubungkan keduanya memerlukan alur koreksi pembelian, bukan menyamakan semua penyesuaian fisik dengan pembayaran.
4. **Gejala tabel kas tertinggal belum berhasil direproduksi.** Pengujian langganan query yang sama dengan halaman Kas memperbarui nominal tabel dan saldo laci setelah persetujuan Owner. Pengujian PostgreSQL juga menunjukkan nominal baru dapat dibaca kembali oleh HO. Saat diperiksa di production, tiga koreksi berstatus disetujui sudah tercermin pada nominal jurnal kas; satu permintaan lain masih menunggu.

## Cakupan pengujian tambahan

- HO membuat stok awal beserta total pembayarannya.
- Restok menghasilkan rata-rata modal dan total kas yang sesuai.
- Penyesuaian fisik mempertahankan jurnal pembayaran yang sudah ada.
- Perubahan modal katalog tidak menulis ulang jurnal historis.
- Restok tanpa pembayaran kemudian hitung fisik ulang tidak menciptakan pengeluaran baru.
- Pengajuan HO tidak diterapkan sebelum persetujuan Owner.
- Query tabel kas dan saldo laci sama-sama menerima perubahan nominal.
- Transaksi HO, penyesuaian stok, pengajuan koreksi, persetujuan Owner, dan pembacaan kembali nominal melalui server PostgreSQL.

Seluruh suite: **156 pengujian lulus, 0 gagal**. Pengujian tambahan memakai data sintetis dan database terisolasi.

## Rekomendasi

- Jelaskan pada Penyesuaian bahwa tindakan tersebut hanya untuk hasil hitung fisik dan tidak mengubah kas.
- Bedakan salah input pembelian dari opname. Sediakan koreksi pembelian tertaut yang menyebut jumlah, modal per pcs, total pengeluaran, dan persetujuan Owner.
- Tampilkan status koreksi yang masih menunggu pada transaksi kas terkait.
- Jangan menghitung ulang modal historis secara otomatis hanya berdasarkan nominal kas yang diedit: barang mungkin sudah terjual, dipakai servis, dicampur dengan batch lain, atau dibayar sebagian. Perlu peninjauan transaksi sumber dan dampaknya terlebih dahulu.

Pemeriksaan satu sesi production dan simulasi lokal belum menyingkirkan kemungkinan jeda sinkronisasi sementara pada perangkat HO. Data yang belum terkirim atau versi aplikasi di perangkat berbeda tetap perlu diperiksa jika gejala muncul kembali.
