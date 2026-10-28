# LEARNING ROADMAP — Implementasi Praktikum Zero Trust Security

Roadmap ini menyajikan panduan langkah demi langkah implementasi arsitektur **Zero Trust Security** berbasis **NIST SP 800-207** untuk mata kuliah Keamanan Informasi, Universitas Siliwangi.

Setiap tahap dirancang bertahap (*incremental*), memiliki tujuan belajar yang terukur, kriteria selesai (*definition of done*), serta pengujian yang harus lulus sebelum beralih ke tahap berikutnya.

---

## Ringkasan Tahapan

```
[ Tahap 1: Fondasi & Analisis Kebutuhan ] (Tahap Saat Ini)
                   │
                   ▼
[ Tahap 2: Skema Database & Data Awal (Seed) ]
                   │
                   ▼
[ Tahap 3: Modul Autentikasi & Policy Engine / Administrator (PE/PA) ]
                   │
                   ▼
[ Tahap 4: Implementasi API Gateway (Policy Enforcement Point - PEP) ]
                   │
                   ▼
[ Tahap 5: Implementasi Resource Services (Nilai & Transkrip) + Defense-in-Depth ]
                   │
                   ▼
[ Tahap 6: Automated Security & Regression Testing ]
                   │
                   ▼
[ Tahap 7: Dokumentasi Pengujian (Thunder Client / cURL) & Persiapan Demo ]
                   │
                   ▼
[ Tahap 8 (Lanjutan): Integrasi Frontend React ] (Dikerjakan setelah backend lulus uji)
```

---

## Rincian Tahapan

### TAHAP 1 — Persiapan Proyek & Pemetaan Konteks Zero Trust (Sedang Berjalan)
- **Tujuan Belajar:**
  - Memahami prinsip fundamental Zero Trust (*Never Trust, Always Verify*, *Least Privilege*, *Assume Breach*).
  - Membedakan peran komponen arsitektur NIST SP 800-207: PEP, PE/PA, Resource Services, dan Audit Logger.
  - Memetakan kebutuhan sistem dari dokumen panduan ke dokumen teknis operasional.
- **Aktivitas:**
  - Memeriksa kelengkapan file sumber panduan (`tugas praktikum zero trust.pdf`) dan environment (Node.js & npm).
  - Menetapkan stack teknologi backend awal (Node.js, Express, SQLite, jsonwebtoken).
  - Menyusun dokumen `PROJECT_CONTEXT.md` dan `docs/LEARNING_ROADMAP.md`.
  - Membuat kerangka struktur folder modular yang bersih.
- **Kriteria Selesai:**
  - File PDF berhasil terbaca dan diverifikasi.
  - Dokumen `PROJECT_CONTEXT.md` dan `docs/LEARNING_ROADMAP.md` telah dibuat.
  - Struktur direktori awal terbentuk rapi.
  - Pengguna memverifikasi dan menyetujui hasil Tahap 1.

---

### TAHAP 2 — Skema Database & Data Awal (SQLite Seeding)
- **Tujuan Belajar:**
  - Mendesain skema relasional yang mendukung Attribute-Based Access Control (ABAC) dan kepemilikan data.
  - Memahami cara menyimpan hash refresh token secara aman dengan kemampuan pencabutan (*instant revocation*).
  - Menyiapkan data awal (*seeding*) yang mencerminkan isolasi data multi-user.
- **Aktivitas:**
  - Membuat modul koneksi database SQLite (`better-sqlite3`).
  - Merancang tabel:
    1. `users`: ID, username, password_hash, role (`admin`, `dosen`, `mahasiswa`), NIM/NIP, nama.
    2. `devices`: ID, user_id, device_id, label, is_active.
    3. `kelas`: ID, kode_mk, nama_mk, dosen_id, status (`DRAFT` / `FINAL`).
    4. `nilai`: ID, kelas_id, mahasiswa_id, nilai_angka, nilai_huruf.
    5. `transkrip`: ID, mahasiswa_id, kode_mk, nama_mk, sks, nilai_huruf, updated_at.
    6. `refresh_tokens`: ID, user_id, token_hash, jti, expires_at, revoked.
    7. `audit_logs`: ID, timestamp, subject, role, endpoint, method, device_id, decision (`ALLOW`/`DENY`), reason.
  - Menulis script migrasi dan seed minimal: 1 Admin, 2 Dosen, 3 Mahasiswa, 2 Kelas terpisah, dan relasi device.
- **Kriteria Selesai & Pengujian:**
  - Script migrasi dan seed dapat dijalankan ulang secara idempotent.
  - Query verifikasi menunjukkan seluruh entitas dan relasi foreign key terisi lengkap.

---

### TAHAP 3 — Modul Autentikasi & Policy Engine / Administrator (PE / PA)
- **Tujuan Belajar:**
  - Mengimplementasikan siklus hidup token (Access Token 10 menit, Refresh Token 1 hari dengan rotasi, Service Token 5 menit).
  - Mengembangkan logika Policy Engine murni yang memisahkan aturan otorisasi dari logika bisnis aplikasi.
  - Mengimplementasikan evaluasi berbasis atribut: device binding, jam kerja (07.00–21.00), kepemilikan kelas dosen, dan NIM mahasiswa.
- **Aktivitas:**
  - Membuat modul hashing password (bcrypt/argon2).
  - Membuat modul token JWT: sign, verify, token expiry handling, dan service token issue.
  - Membuat modul `policy.js` (Policy Engine): fungsi evaluator yang menerima `(subject, action, resource, context)` dan mengembalikan `{ decision: 'ALLOW'|'DENY', reason: '...' }`.
  - Menyiapkan mekanisme simulasi waktu (`X-Mock-Hour`) untuk pengujian temporal bounds yang deterministik.
- **Kriteria Selesai & Pengujian:**
  - Unit test fungsi evaluator menghasilkan `ALLOW` / `DENY` sesuai matriks kebijakan.
  - Simulasi pencabutan refresh token berhasil menggagalkan penerbitan access token baru.

---

### TAHAP 4 — Implementasi API Gateway sebagai PEP (Port 3000)
- **Tujuan Belajar:**
  - Membangun reverse proxy menggunakan Express yang bertindak sebagai pintu gerbang tunggal (*Single Ingress PEP*).
  - Mengintegrasikan middleware interceptor yang memanggil Policy Engine sebelum request diteruskan.
  - Mengotomasi pencatatan Audit Log untuk setiap keputusan akses.
  - Menyuntikkan header rahasia internal `X-Gateway-Secret` saat meneruskan request ke resource service.
- **Aktivitas:**
  - Membuat server Express di port `3000`.
  - Menerapkan routing `/auth/*` yang ditangani langsung oleh Gateway (Policy Administrator).
  - Menerapkan middleware PEP untuk endpoint `/nilai` dan `/transkrip`.
  - Mengintegrasikan `http-proxy-middleware` dengan penanganan restreaming body dan pelestarian path URL.
  - Menulis helper audit logging yang aman (tanpa mencatat password/secret).
- **Kriteria Selesai & Pengujian:**
  - Endpoint `/auth/login` berfungsi dan menolak login jika device tidak cocok.
  - Request tanpa token atau dengan device tidak terdaftar langsung dipotong di Gateway (HTTP 401/403) dan tercatat di `audit_logs`.

---

### TAHAP 5 — Implementasi Resource Services & Defense-in-Depth
- **Tujuan Belajar:**
  - Menerapkan prinsip *Never Trust, Always Verify* pada level internal microservice.
  - Membangun mekanisme perlindungan terhadap direct access bypass via verifikasi `X-Gateway-Secret`.
  - Menerapkan verifikasi token mandiri di dalam setiap resource service.
  - Membangun alur panggilan antar-service (*Service-to-Service*) yang wajib melalui Gateway PEP menggunakan Service Token.
- **Aktivitas:**
  - Membangun **Service Nilai (Port 3001)**:
    - Middleware verifikasi `X-Gateway-Secret` + verifikasi JWT.
    - Endpoint `GET /nilai`, `PUT /nilai/:id`, dan `POST /kelas/:id/finalisasi`.
    - Logika finalisasi: mengubah status kelas menjadi `FINAL` dan memanggil `POST /transkrip/sinkron` via Gateway (port 3000) berbekal Service Token.
  - Membangun **Service Transkrip (Port 3002)**:
    - Middleware verifikasi `X-Gateway-Secret` + verifikasi JWT.
    - Endpoint `GET /transkrip/:nim` (Mahasiswa melihat NIM sendiri, Admin melihat semua).
    - Endpoint `POST /transkrip/sinkron` (Strict: hanya menerima `role: 'service'`).
- **Kriteria Selesai & Pengujian:**
  - Panggilan langsung ke port 3001 atau 3002 via cURL ditolak (`403 Direct Access Forbidden`).
  - Alur finalisasi nilai berhasil mengalirkan data ke transkrip melalui Gateway PEP.

---

### TAHAP 6 — Automated Security & Regression Testing
- **Tujuan Belajar:**
  - Memvalidasi seluruh postur keamanan Zero Trust secara otomatis dan terulang (*repeatable*).
  - Menyusun test suite skenario negatif (*negative security cases*).
- **Aktivitas & Skenario Uji:**
  1. `[AUTH]` Login kredensial benar + device cocok -> 200 OK (Access & Refresh Token).
  2. `[AUTH]` Login kredensial benar + device tidak terdaftar -> 401/403 Ditolak.
  3. `[AUTH]` Refresh token valid -> 200 OK (Token baru).
  4. `[AUTH]` Refresh token setelah logout -> 401 Ditolak (Revoked).
  5. `[PEP]` Request tanpa token -> 401 Ditolak.
  6. `[PEP]` Request dengan token kedaluwarsa -> 401 Ditolak.
  7. `[ABAC - Device]` Request user dengan device yang tidak terdaftar di database -> 403 Ditolak.
  8. `[ABAC - IDOR]` Mahasiswa A mencoba melihat nilai/transkrip Mahasiswa B -> 403 Ditolak.
  9. `[ABAC - Ownership]` Dosen A mencoba mengubah nilai pada kelas Dosen B -> 403 Ditolak.
  10. `[ABAC - Time]` Dosen mengubah/finalisasi nilai di luar jam 07.00–21.00 -> 403 Ditolak.
  11. `[ABAC - Immutability]` Mengubah nilai kelas yang sudah berstatus `FINAL` -> 403 Ditolak.
  12. `[DEFENSE]` Akses langsung ke port 3001/3002 tanpa `X-Gateway-Secret` -> 403 Ditolak.
  13. `[DEFENSE]` Akses langsung ke port 3001/3002 dengan `X-Gateway-Secret` tapi tanpa token -> 401 Ditolak.
  14. `[S2S]` Panggilan sinkron transkrip menggunakan user token (Admin/Dosen/Mahasiswa) -> 403 Ditolak.
  15. `[S2S]` Panggilan sinkron transkrip menggunakan Service Token yang sah -> 200 OK.
  16. `[AUDIT]` Memverifikasi bahwa setiap event pengujian menghasilkan baris audit log berstatus `ALLOW` atau `DENY` beserta alasan akurat.
- **Kriteria Selesai:**
  - Seluruh skenario pengujian di atas berjalan dan lulus 100%.

---

### TAHAP 7 — Artefak Pengujian Interaktif & Persiapan Presentasi Video
- **Tujuan Belajar:**
  - Menyediakan instrumen pengujian yang mudah dievaluasi oleh dosen pengampu.
  - Mempersiapkan materi presentasi dan demonstrasi teknis berdurasi 6–9 menit sesuai panduan tugas.
- **Aktivitas:**
  - Menghasilkan file koleksi VS Code Thunder Client (`docs/thunder-collection_zero-trust.json`).
  - Menghasilkan file koleksi Postman v2.1 (`docs/zero-trust.postman_collection.json`).
  - Menyusun panduan skrip cURL satu baris yang kompatibel dengan terminal Windows CMD dan Git Bash.
  - Menyusun outline skenario demo video (6–9 menit) yang memetakan setiap poin pengujian ke potongan kode sumber yang relevan.
- **Kriteria Selesai:**
  - Koleksi dapat diimpor langsung tanpa modifikasi manual dan request berjalan sukses.
  - Outline demo video siap dipakai untuk rekaman.

---

### TAHAP 8 (Lanjutan / Ekstensi) — Integrasi Frontend React
- **Tujuan Belajar:**
  - Menghubungkan antarmuka visual ke arsitektur Zero Trust tanpa mengorbankan postur keamanan.
- **Catatan Kebijakan:**
  - *Sesuai aturan panduan praktikum, tahap ini HANYA dikerjakan setelah seluruh pengujian backend pada Tahap 6 dan 7 selesai dan terverifikasi secara tuntas.*
