# Katalog awal sparepart

Seed memuat **30 jenis sparepart**, semuanya berkategori `sparepart`: 10 LCD, 10 baterai, 5 fleksibel charger, 2 konektor charger, 2 speaker bawah, dan 1 motor getar.

Stok, harga modal, dan harga jual dimulai dari **0**. Stok minimum adalah 2 untuk komponen per model dan 5 untuk konektor. Setiap item memiliki merek HP: Samsung, Apple, Vivo, Oppo, Xiaomi, atau Universal untuk konektor umum. Seed hanya menyiapkan daftar barang; tidak membuat transaksi kas, nota, atau akun pengguna. Nama/model merupakan daftar awal yang bisa disesuaikan dengan varian, kualitas, dan barang yang benar-benar dijual toko.

## Mode lokal

Halaman stok tidak menyediakan tombol pemuatan seed. Sumber JSON dan helper `seedParts(user)` pada [seed-parts.ts](/Users/mac/Workspace/lumen-service/src/db/seed-parts.ts) tetap tersedia untuk pengembangan dan pengujian lokal.

Untuk pencatatan operasional, gunakan **Stok → Sparepart & Aksesoris → Tambah Item**. Klik barang untuk menyesuaikan nama, harga, dan batas stok. Tambahkan persediaan melalui **Restok** beserta biaya pembeliannya, atau gunakan penyesuaian stok sesuai hasil opname.

Pemuatan dicatat di audit dan dijalankan dalam satu transaksi. Bila gagal, seluruh penambahan dibatalkan. Dua pemuatan bersamaan tidak menggandakan data.

## Supabase

Setelah skema Lumen termasuk migrasi `202610200005_part_brands.sql` dan `202610200006_simplify_part_brands.sql` terpasang, jalankan isi [supabase/seed.sql](/Users/mac/Workspace/lumen-service/supabase/seed.sql) lewat SQL Editor sebagai administrator. Setelah itu, sinkronkan aplikasi untuk mengambil daftar barang. Tidak perlu menjalankan ulang skema atau mereset database.

Seed SQL memakai transaksi dan penguncian tabel saat menambahkan data. Barang yang memiliki ID sama atau nama/kategori sama dilewati; perbandingan nama mengabaikan kapital serta spasi berulang. Harga, stok, nama, dan revisi barang yang sudah ada tidak diperbarui. Katalog ini terpisah dari migrasi sehingga pemasangan atau pembaruan aplikasi tidak otomatis menambahkan barang ke toko.

Di mode cloud, muat katalog dari SQL saja. Ini menghindari dua perangkat mengirim penambahan katalog yang sama ke antrean sinkronisasi.

## Mengubah isi seed

Sumber bersama untuk lokal dan SQL adalah [spareparts.json](/Users/mac/Workspace/lumen-service/src/db/seeds/spareparts.json). Pertahankan ID barang yang sudah ada. Tambahkan ID UUID baru untuk barang baru.

Setelah mengedit sumber:

```sh
npm run seed:generate
npm run seed:check
bun test
```

Generator memvalidasi ID, nama unik, dan stok minimum. Pemeriksaan CI memastikan file SQL sesuai dengan JSON. Mengubah seed tidak memperbarui barang yang sudah dimuat; ubah barang tersebut melalui aplikasi.
