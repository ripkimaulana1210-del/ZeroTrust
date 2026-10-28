# PROJECT CONTEXT — Zero Trust Security Praktikum

Dokumen ini adalah acuan arsitektur dan persyaratan resmi untuk tugas praktikum individu mata kuliah **Keamanan Informasi (KP70065004)**, Jurusan Informatika, Universitas Siliwangi. Dokumen disusun berdasarkan panduan pada file `tugas praktikum zero trust.pdf` serta standar **NIST SP 800-207**.

---

## 1. Prinsip Utama Zero Trust

Sistem dibangun dengan memegang teguh tiga prinsip dasar Zero Trust:
1. **Never Trust, Always Verify:**
   - Tidak ada kepercayaan tersirat (*implicit trust*) berdasarkan lokasi jaringan (LAN, localhost, maupun antar-service).
   - Setiap permintaan (*request*), baik dari klien eksternal maupun panggilan antar-service (*service-to-service*), wajib diautentikasi dan diotorisasi secara eksplisit di setiap lapisan.
2. **Least Privilege:**
   - Hak akses hanya diberikan sesuai kebutuhan peran (*role*) dan kepemilikan data (*attribute/ownership*).
3. **Assume Breach:**
   - Asumsikan perimeter jaringan dapat ditembus.
   - Seluruh keputusan akses dicatat dalam *Audit Log*.
   - Refresh token dapat segera dicabut (*revoked*) saat logout.
   - Resource service melakukan verifikasi mandiri (*defense-in-depth*).

---

## 2. Pemetaan Komponen Arsitektur (NIST SP 800-207)

```
[ Klien / Mahasiswa / Dosen / Admin ]
                 │
                 │ HTTP Request + Bearer JWT + X-Device-ID
                 ▼
┌────────────────────────────────────────────────────────┐
│ API GATEWAY (Port 3000)                                │
│ ├─ Policy Enforcement Point (PEP):                     │
│ │  Mencegat seluruh request masuk & memblokir akses    │
│ ├─ Policy Engine (PE) & Policy Administrator (PA):    │
│ │  Evaluasi aturan RBAC/ABAC, issue & revoke token     │
│ └─ Audit Logger:                                       │
│    Mencatat seluruh keputusan ALLOW / DENY & alasannya │
└───────────────────┬────────────────────────────────────┘
                    │ Forward via HTTP Proxy
                    │ + Header: X-Gateway-Secret + Bearer JWT
         ┌──────────┴──────────┐
         ▼                     ▼
┌─────────────────────┐   ┌───────────────────────────┐
│ SERVICE NILAI       │   │ SERVICE TRANSKRIP         │
│ (Port 3001)         │   │ (Port 3002)               │
│ - Verifikasi Secret │   │ - Verifikasi Secret       │
│ - Verifikasi Token  │   │ - Verifikasi Token        │
│                     │   │   (User / Service Token)  │
└──────────┬──────────┘   └───────────────────────────┘
           │ Panggilan S2S (via Gateway PEP)
           │ Authorization: Bearer <Token Service>
           └─────────► [ Gateway PEP: Port 3000 ] ─────────► [ Service Transkrip: 3002 ]
```

| Komponen | Peran NIST SP 800-207 | Port | Tanggung Jawab Utama |
|---|---|---|---|
| **API Gateway** | PEP (Policy Enforcement Point) | `3000` | Pintu masuk tunggal sistem. Mencegat semua traffic, meminta evaluasi ke PE, menulis audit log, dan mem-proxy request yang diizinkan ke resource service dengan menambahkan header `X-Gateway-Secret`. |
| **Policy Engine / Policy Administrator** | PE / PA | *(Modul Gateway)* | Mengelola login, menerbitkan JWT, mencabut refresh token, serta memutuskan `ALLOW` atau `DENY` berdasarkan aturan role, kepemilikan data (DB), device ID, dan jam akses. |
| **Service Nilai** | Resource Service | `3001` | Mengelola data nilai dan kelas mata kuliah. Memverifikasi `X-Gateway-Secret` dan JWT. Menginisiasi sinkronisasi ke Service Transkrip via Gateway PEP saat finalisasi nilai kelas. |
| **Service Transkrip** | Resource Service | `3002` | Mengelola data transkrip akademik mahasiswa. Memverifikasi `X-Gateway-Secret` dan JWT. Endpoint sinkronisasi hanya dapat diakses menggunakan Service Token. |
| **Database Bersama** | Resource / State Store | *(SQLite)* | Satu database bersama (`database.sqlite`) yang diakses secara lokal oleh komponen backend. |
| **Audit Log** | Telemetry / Data Source | *(Tabel DB / File)* | Menyimpan riwayat setiap keputusan evaluasi kebijakan (waktu, subjek, endpoint, device, keputusan, dan alasan). |

---

## 3. Matriks Token dan Kredensial

| Jenis Kredensial | Masa Berlaku | Format / Claims | Mekanisme & Penanganan |
|---|---|---|---|
| **Access Token** | 10 Menit | JWT: `sub` (User ID), `role`, `nim` / `nip`, `jti` | Dibawa pada header `Authorization: Bearer <token>`. Stateless verification. |
| **Refresh Token** | 1 Hari (24 Jam) | Opaque Token / UUID / JWT | Disimpan di database. Dirotasi pada setiap pembaruan dan dicabut (*revoked*) saat user logout. |
| **Service Token** | 5 Menit | JWT: `sub` (client ID), `role: 'service'` | Diperoleh Service Nilai via `POST /auth/service` menggunakan Client ID & Client Secret. |
| **Gateway Secret** | Tetap (*Env Config*) | String acak berkekuatan tinggi | Disisipkan oleh API Gateway pada header `X-Gateway-Secret`. Wajib divalidasi oleh Service Nilai & Transkrip. |

> **Catatan Keamanan Penting:** Jangan pernah menaruh nilai asli secret (`JWT_SECRET`, `GATEWAY_SECRET`, atau password akun) di dalam dokumentasi maupun commit git. Gunakan file `.env.example` sebagai acuan format konfigurasi.

---

## 4. Kebijakan Akses Endpoint (Policy Matrix)

Semua endpoint wajib diakses melalui API Gateway (`http://localhost:3000`).

| No | Endpoint | Ditangani Oleh | Role yang Diizinkan | Kondisi / Aturan Kebijakan (ABAC & Konteks) |
|---|---|---|---|---|
| 1 | `POST /auth/login` | Gateway | Semua User | Kredensial valid (username & password) dan device terdaftar (`X-Device-ID`). |
| 2 | `POST /auth/refresh` | Gateway | Semua User | Refresh token valid, aktif, dan belum dicabut di database. |
| 3 | `POST /auth/logout` | Gateway | Semua User | Mencabut refresh token aktif milik user di database. |
| 4 | `POST /auth/service` | Gateway | Service Nilai | Client ID dan Client Secret service valid. Menghasilkan Service Token (5 menit). |
| 5 | `GET /nilai` | Service Nilai | `mahasiswa`, `dosen` | **Mahasiswa:** hanya melihat nilai miliknya sendiri.<br>**Dosen:** hanya melihat nilai pada kelas yang diampunya. |
| 6 | `PUT /nilai/:id` | Service Nilai | `dosen` | Hanya dosen pengampu kelas terkait, status kelas/nilai belum `FINAL`, dan dilakukan dalam jam akses (07.00–21.00). |
| 7 | `POST /kelas/:id/finalisasi` | Service Nilai | `dosen` | Hanya dosen pengampu kelas terkait dan dilakukan dalam jam akses (07.00–21.00). Pasca finalisasi, Service Nilai memicu sinkronisasi transkrip. |
| 8 | `GET /transkrip/:nim` | Service Transkrip | `mahasiswa`, `admin` | **Mahasiswa:** hanya dapat melihat transkrip miliknya sendiri (`NIM` token = `NIM` parameter).<br>**Admin:** diizinkan melihat transkrip seluruh NIM. |
| 9 | `POST /transkrip/sinkron` | Service Transkrip | `service` | **Hanya** diizinkan menggunakan Token Service (`role: service`). Seluruh token user (`admin`, `dosen`, `mahasiswa`) **wajib ditolak (403)**. |

---

## 5. Verifikasi Konteks (ABAC)

1. **Device Binding (`X-Device-ID`):**
   - Setiap request user (selain public login) wajib menyertakan header `X-Device-ID`.
   - Policy Engine memeriksa relasi `user_id` dengan `device_id` pada tabel `devices`. Request dengan device yang tidak terdaftar akan ditolak.
2. **Temporal Bounds (Jam Akses):**
   - Endpoint manipulasi nilai (`PUT /nilai/:id` dan `POST /kelas/:id/finalisasi`) hanya diizinkan beroperasi antara pukul **07.00 s.d. 21.00 WIB**.
   - Batas jam dapat dikonfigurasi melalui *environment variable* atau mendukung *mock header* (`X-Mock-Hour`) agar mudah didemokan dan diuji otomatis kapan saja.
3. **Data Ownership & Immutability:**
   - Dosen tidak dapat mengubah nilai kelas dosen lain.
   - Mahasiswa tidak dapat melihat nilai/transkrip mahasiswa lain (*IDOR Protection*).
   - Nilai kelas yang sudah difinalisasi (*status = FINAL*) bersifat *immutable* (tidak dapat diubah kembali).

---

## 6. Pertahanan Berlapis (*Defense-in-Depth*)

Internal resource service (Nilai & Transkrip) menerapkan pengamanan mandiri:
1. **Penolakan Akses Langsung (*Direct Access Rejection*):**
   - Service memeriksa header `X-Gateway-Secret`.
   - Request langsung ke port `3001` atau `3002` tanpa header ini akan ditolak (`403 Forbidden`).
2. **Validasi Ulang Token Mandiri (*Independent Token Verification*):**
   - Service memverifikasi signature dan masa berlaku JWT secara independen.
   - Adanya header `X-Gateway-Secret` tanpa token yang valid tetap ditolak (`401 Unauthorized`).
3. **Panggilan Antar-Service Wajib Melalui Gateway:**
   - Saat finalisasi, Service Nilai meminta Service Token dari Gateway (`POST /auth/service`).
   - Service Nilai memanggil `POST /transkrip/sinkron` **melalui Gateway (port 3000)**, bukan langsung membypass ke port internal Service Transkrip (3002).

---

## 7. Format Audit Logging

Setiap evaluasi kebijakan oleh Gateway wajib dicatat ke tabel `audit_logs` dengan format:
- `timestamp`: Format ISO 8601 UTC / WIB.
- `subject`: ID user (`user.id`) atau identitas service (`service-nilai`), atau `anonymous`.
- `role`: `admin`, `dosen`, `mahasiswa`, `service`, atau `none`.
- `endpoint`: HTTP Method & path (contoh: `PUT /nilai/1`).
- `device_id`: Nilai header `X-Device-ID` (jika ada).
- `decision`: `ALLOW` atau `DENY`.
- `reason`: Alasan spesifik keputusan (contoh: `"Device tidak terdaftar"`, `"Di luar jam akses"`, `"Bukan dosen pengampu"`, `"Akses diizinkan"`).

---

## 8. Data Awal (Seed Data Specification)

Sesuai ketentuan teknis tugas praktikum, seed data meliputi akun demo berikut:
1. **User Accounts:**
   - **Admin:** `admin` (Pass: `admin123`, Identifier: `ADM001`, Device: `dev-admin-01`)
   - **Dosen 1:** `dosen_budi` (Pass: `dosen123`, Identifier: `198501012010121001`, Device: `dev-dosen-budi`)
   - **Dosen 2:** `dosen_siti` (Pass: `dosen123`, Identifier: `198702022012122002`, Device: `dev-dosen-siti`)
   - **Mahasiswa 1:** `mhs_ahmad` (Pass: `mhs123`, NPM: `247006001`, Device: `dev-mhs-ahmad`)
   - **Mahasiswa 2:** `mhs_rizki` (Pass: `mhs123`, NPM: `247006002`, Device: `dev-mhs-rizki`)
   - **Mahasiswa 3:** `mhs_dewi` (Pass: `mhs123`, NPM: `247006003`, Device: `dev-mhs-dewi`)
2. **Devices:**
   - Setiap akun user memiliki minimal 1 `device_id` unik yang terikat (*bound*) di database.
3. **Kelas & Nilai:**
   - Kelas 1: `IF2101` (*Keamanan Informasi*) — diampu `dosen_budi`, status `DRAFT`.
   - Kelas 2: `IF2102` (*Jaringan Komputer Lanjut*) — diampu `dosen_siti`, status `DRAFT`.
   - Masing-masing kelas memuat data nilai untuk ketiga mahasiswa.

---

## 9. Luaran Tugas Praktikum

1. **Repository Kode & README:**
   - Dokumentasi cara instalasi dan menjalankan ketiga service.
   - Daftar akun uji (username, password, role) dan nilai `device_id` terkait.
   - Kumpulan contoh perintah pengujian (cURL / Thunder Client).
2. **Video Demo (Durasi 6–9 Menit):**
   - Mendemonstrasikan seluruh skenario pada Bagian 4.
   - Memperlihatkan potongan kode sumber yang bertanggung jawab atas penegakan kebijakan.
   - Menunjukkan audit log yang mencatat keputusan `ALLOW` dan `DENY`.
