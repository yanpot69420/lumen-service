# Lumen Service — Planning Sistem Web (PWA)

Sistem operasional konter servis HP & jual beli HP second.
Konteks: usaha rintisan 2 partner — **Owner/pemodal** (pantau jarak jauh) dan **Head Operasional** (menjalankan toko: admin, kasir, sekaligus teknisi). Karyawan tambahan menyusul di kemudian hari.

## 1. Arsitektur Produk

Satu aplikasi, dua sisi:

| Sisi | Pengguna | Rilis |
|---|---|---|
| **Internal (PWA)** — nota servis, kasir jual-beli, stok, kas, laporan, dashboard | Owner & Head Ops | **Duluan** (Fase 1–4) |
| **Publik** — profil Lumen Service, katalog HP second, cek status servis, tombol WA | Pelanggan | Menyusul (Fase 5) |

Perangkat: input harian di **HP Android** (mobile-first), pekerjaan panjang (stok opname, laporan, review bulanan) di **laptop/PC konter** — UI responsif untuk keduanya.

## 2. Peran & Prinsip Akses

**Fase awal — 2 peran:**
- **Owner (pemodal):** semua laporan & dashboard, audit log, approval koreksi, kelola akun.
- **Head Ops (partner):** akses operasional penuh **termasuk harga modal & laba** — dia yang nego harga beli unit dan berhak tahu performa usaha.

**Disiapkan tapi belum diaktifkan:** peran `Kasir` dan `Teknisi` dengan akses terbatas (tanpa modal/laba), dinyalakan saat rekrut karyawan.

**Prinsip berlaku dua arah (termasuk Owner):**
1. Transaksi tidak bisa diedit/dihapus mundur — koreksi lewat **jurnal koreksi** tercatat (siapa, kapan, alasan).
2. Semua aksi masuk **audit log** — pelindung kedua pihak, bukan alat curiga.
3. Ambil uang (prive) siapa pun wajib tercatat.

## 3. Modul

### A. Servis HP (ticketing)
- Nota masuk cepat (**target < 1 menit di HP**): pelanggan, merk/tipe, keluhan, kelengkapan, estimasi, DP, **foto kondisi HP** (bukti sengketa).
- Status: `Masuk → Dicek → Konfirmasi harga → Dikerjakan → Selesai → Diambil` (+ `Batal`).
- Nota keluar: **cetak thermal Bluetooth + kirim gambar/PDF via WA** (dua-duanya).
- Notifikasi WA semi-otomatis saat status berubah (link `wa.me` + template pesan).

### B. Jual Beli HP
- Stok unit dengan **IMEI wajib** (legalitas, anti barang curian, anti tukar unit).
- Beli dari pelanggan: foto KTP penjual + foto kondisi + harga beli.
- Jual: harga jual, garansi toko, nota otomatis (thermal + WA).

### C. Sparepart & Aksesoris
- Stok sederhana; berkurang otomatis saat dipakai di nota servis.

### D. Kas & Laporan
- Kas harian masuk/keluar + **tutup kas harian** (selisih langsung kelihatan).
- Laporan: omzet & laba harian/bulanan, laba per unit, nilai stok, **umur stok** (unit >60 hari = modal mati), servis per status.

### E. Dashboard Owner ("rapor", bukan pengawasan)
- Hari ini: kas masuk, nota servis aktif, unit terjual.
- Bulan berjalan: laba, nilai stok (tempat modal "parkir"), umur stok.
- Audit log & daftar koreksi menunggu approval.
- Ritual non-teknis: **review bareng bulanan** — buka dashboard berdua, cocokkan kas fisik, sepakati angka.

## 4. PWA & Teknis

- **Stack:** React + Vite + TypeScript + Tailwind + shadcn/ui; `vite-plugin-pwa` (installable, service worker).
- **Backend:** Supabase — PostgreSQL, Auth, Row Level Security per peran, Storage untuk foto.
- **Offline-tolerant:** nota & transaksi tetap bisa dibuat saat internet putus (IndexedDB), sinkron otomatis saat online.
- **Cetak:** Web Bluetooth → printer thermal ESC/POS; fallback share nota sebagai gambar ke WA.
- **Hosting:** Vercel/Netlify + domain sendiri (~Rp150–200rb/tahun). Biaya operasional awal ≈ nol selain domain & printer (~Rp200–400rb).
- **Catatan dev (mesin ini):** port TCP 5041–5440 & 5549–5748 diblokir Windows — set dev server ke port di luar rentang itu (mis. 3000), jangan pakai default Vite 5173.

## 5. Tahapan

| Fase | Isi | Estimasi |
|---|---|---|
| **1. Fondasi** | Setup proyek + PWA shell, Supabase, auth 2 peran (+2 dorman), skema DB, layout responsif HP/desktop | 1 minggu |
| **2. Servis** | Nota masuk + foto, alur status, cetak thermal + share WA, template pesan WA | 1–2 minggu |
| **3. Jual Beli & Stok** | Inventory IMEI, beli/jual unit, sparepart | 1–2 minggu |
| **4. Kas, Laporan, Dashboard** | Tutup kas, jurnal koreksi + approval, audit log, dashboard owner → **launch internal, mulai dipakai harian** | 1 minggu |
| **5. Web Publik** | Landing Lumen Service, katalog HP second, cek status via nomor nota | 1 minggu |
| **6. Poles** | Offline sync mantap, perbaikan dari pemakaian nyata, onboarding peran karyawan | berkelanjutan |

Total sampai launch internal: **±4–6 minggu**. Fase 2 sudah bisa dipakai di toko begitu selesai — tidak perlu menunggu semuanya.

## 6. Di Luar Kode (prasyarat sebelum launch)

- **Kesepakatan tertulis:** gaji bulanan Head Ops (sebelum bagi hasil), porsi bagi hasil dari laba bersih, status modal Owner (penyertaan vs pinjaman), aturan prive.
- Komitmen bersama: **semua transaksi lewat sistem, tanpa kecuali.**
- Foto kondisi wajib saat terima servis & beli unit.
