# Modul Database & Seeding (SQLite)

Modul ini bertanggung jawab atas penyediaan dan pengelolaan state database bersama SQLite (`data/database.sqlite`) yang digunakan oleh seluruh komponen Zero Trust (API Gateway PEP, Policy Engine, Service Nilai, dan Service Transkrip).

---

## 1. Skema Tabel dan Relasi

| Tabel | Deskripsi | Constraints Penting |
|---|---|---|
| `users` | Akun pengguna (Admin, Dosen, Mahasiswa) | `username` UNIQUE, `identifier` UNIQUE, `CHECK(role IN ('admin', 'dosen', 'mahasiswa'))` |
| `devices` | Perangkat terdaftar terikat pada akun pengguna | `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, `UNIQUE(user_id, device_id)` |
| `kelas` | Mata kuliah yang diampu oleh dosen | `FOREIGN KEY (dosen_id) REFERENCES users(id) ON DELETE RESTRICT`, `CHECK(status IN ('DRAFT', 'FINAL'))` |
| `nilai` | Nilai mahasiswa per kelas | `FOREIGN KEY (kelas_id) REFERENCES kelas(id) ON DELETE CASCADE`, `FOREIGN KEY (mahasiswa_id) REFERENCES users(id) ON DELETE CASCADE`, `UNIQUE(kelas_id, mahasiswa_id)`, `CHECK(nilai_angka BETWEEN 0 AND 100)` |
| `transkrip` | Ringkasan transkrip kumulatif mahasiswa | `FOREIGN KEY (mahasiswa_id) REFERENCES users(id) ON DELETE CASCADE`, `UNIQUE(mahasiswa_id, kode_mk)` |
| `refresh_tokens` | Penyimpanan hash refresh token aktif | `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, `token_hash` UNIQUE, `jti` UNIQUE, `CHECK(revoked IN (0, 1))` |
| `audit_logs` | Catatan audit trail keputusan Policy Engine | `CHECK(decision IN ('ALLOW', 'DENY'))`, timestamp dan subject terindeks |

---

## 2. Akun Demo & Data Awal (Seed Data)

Seluruh password disimpan dalam bentuk hash bcrypt (salt rounds = 10).

| Role | Username | Password Plain | Identifier (NIM / NIP) | Nama Lengkap | Registered Device ID |
|---|---|---|---|---|---|
| **Admin** | `admin` | `admin123` | `ADM001` | Administrator Akademik | `dev-admin-01` |
| **Dosen** | `dosen_budi` | `dosen123` | `198501012010121001` | Budi Santoso, M.Kom. | `dev-dosen-budi` |
| **Dosen** | `dosen_siti` | `dosen123` | `198702022012122002` | Dr. Siti Aminah, M.T. | `dev-dosen-siti` |
| **Mahasiswa** | `mhs_ahmad` | `mhs123` | `247006001` | Ahmad Fauzi | `dev-mhs-ahmad` |
| **Mahasiswa** | `mhs_rizki` | `mhs123` | `247006002` | Rizki Pratama | `dev-mhs-rizki` |
| **Mahasiswa** | `mhs_dewi` | `mhs123` | `247006003` | Dewi Lestari | `dev-mhs-dewi` |

### Kelas Perkuliahan:
1. `IF2101` — **Keamanan Informasi** (Dosen: `dosen_budi`, Status: `DRAFT`)
   - Siswa: `mhs_ahmad` (85.0 / A), `mhs_rizki` (78.0 / B), `mhs_dewi` (82.0 / AB)
2. `IF2102` — **Jaringan Komputer Lanjut** (Dosen: `dosen_siti`, Status: `DRAFT`)
   - Siswa: `mhs_ahmad` (80.0 / AB), `mhs_rizki` (88.0 / A), `mhs_dewi` (72.0 / BC)

---

## 3. Perintah Inisialisasi dan Reset Database

### Inisialisasi Database (Idempoten)
Perintah ini akan membuat folder `data/` jika belum ada, menjalankan migrasi skema tabel, dan mengisikan seed data awal. Jika data sudah ada, perintah ini aman dijalankan kembali tanpa menduplikasi data:
```bash
npm run db:init
# atau: node database/init.js
```

### Reset Database Demo (Clean State)
Perintah ini menghapus seluruh data tabel, mengosongkan sequence auto-increment SQLite (`sqlite_sequence`), menjalankan ulang migrasi, dan mengisikan seed data dari awal:
```bash
npm run db:reset
# atau: node database/reset.js
```

---

## 4. Pengujian Otomatis

Untuk menjalankan unit test skema, relasi, constraint, enkripsi password, dan idempoten seed:
```bash
npm test
# atau: node --test tests/**/*.test.js
```
