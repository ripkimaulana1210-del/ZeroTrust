# Sistem Penilaian Akademik Berbasis Zero Trust Security
> **Tugas Praktikum Individu Keamanan Informasi (KP70065004)**  
> **Jurusan Informatika — Fakultas Teknik, Universitas Siliwangi**  
> Mengacu pada Standar **NIST SP 800-207 (Zero Trust Architecture)**

---

## 1. Ringkasan & Prinsip Utama Zero Trust

Sistem ini mengimplementasikan pengelolaan nilai mata kuliah dan transkrip akademik mahasiswa menggunakan arsitektur keamanan **Zero Trust** yang merujuk pada standar **NIST SP 800-207**. Sistem menjamin integritas data akademik dengan menerapkan tiga prinsip dasar:

1. **Never Trust, Always Verify:**
   - Tidak ada kepercayaan tersirat (*implicit trust*) berdasarkan lokasi jaringan, baik koneksi publik, LAN, maupun antarlocalhost.
   - Semua panggilan dari pengguna maupun panggilan antarlayanan (*Service-to-Service / S2S*) wajib melewati **API Gateway** sebagai **Policy Enforcement Point (PEP)**.
   - Resource service internal (*Service Nilai* dan *Service Transkrip*) menerapkan pertahanan berlapis (*Defense-in-depth*) dengan memvalidasi header rahasia `X-Gateway-Secret` dan memverifikasi token JWT secara mandiri.

2. **Least Privilege:**
   - Hak akses dibatasi secara ketat menggunakan kombinasi **Role-Based Access Control (RBAC)** dan **Attribute-Based Access Control (ABAC)**.
   - Mahasiswa hanya dapat melihat nilai dan transkrip miliknya sendiri (*Anti-IDOR Protection*).
   - Dosen hanya dapat melihat, mengubah, dan memfinalisasi nilai pada kelas yang diampunya (*Data Ownership*).
   - Admin berhak melihat transkrip seluruh mahasiswa untuk keperluan verifikasi akademik.

3. **Assume Breach:**
   - Asumsikan perimeter jaringan dapat ditembus.
   - Refresh token disimpan di database dan dapat dicabut (*revoked*) seketika saat user logout.
   - Mutasi data dibatasi oleh batas jam operasional (07.00–21.00 WIB).
   - Setiap keputusan akses (`ALLOW` maupun `DENY`) dicatat secara mendalam ke dalam **Audit Log** untuk keperluan telemetri dan investigasi forensik.

---

## 2. Arsitektur Sistem (NIST SP 800-207)

Sistem dirancang dengan arsitektur microservices yang memisahkan fungsi penegakan kebijakan dari resource service:

```
[ Klien / Mahasiswa / Dosen / Admin ]
                 │
                 │ HTTP Request + Bearer JWT + X-Device-ID
                 ▼
┌────────────────────────────────────────────────────────┐
│ API GATEWAY (Port 3000)                                │
│ ├─ Policy Enforcement Point (PEP):                     │
│ │  Mencegat seluruh request & memblokir akses ilegal   │
│ ├─ Policy Engine (PE) & Policy Administrator (PA):    │
│ │  Evaluasi aturan RBAC/ABAC, issue & revoke token     │
│ └─ Audit Logger:                                       │
│    Mencatat keputusan ALLOW / DENY beserta alasannya   │
└───────────────────┬────────────────────────────────────┘
                    │ Forward via HTTP Reverse Proxy
                    │ + Header: X-Gateway-Secret + Bearer JWT
         ┌──────────┴──────────┐
         ▼                     ▼
┌─────────────────────┐   ┌───────────────────────────┐
│ SERVICE NILAI       │   │ SERVICE TRANSKRIP         │
│ (Port 3001)         │   │ (Port 3002)               │
│ - Verifikasi Secret │   │ - Verifikasi Secret       │
│ - Verifikasi Token  │   │ - Verifikasi Token        │
└──────────┬──────────┘   └───────────────────────────┘
           │ Panggilan S2S (Wajib via Gateway PEP Port 3000)
           │ Authorization: Bearer <Token Service 5 Menit>
           └─────────► [ Gateway PEP: Port 3000 ] ─────────► [ Service Transkrip: 3002 ]
```

### Pemetaan Komponen Sistem (Tabel 2 Panduan Praktikum):

| Komponen | Peran NIST SP 800-207 | Port | Tanggung Jawab Utama |
|---|---|---|---|
| **API Gateway** | **PEP** (Policy Enforcement Point) | `3000` | Pintu masuk tunggal sistem. Memeriksa setiap request, meminta keputusan evaluasi ke Policy Engine, mencatat audit log, dan meneruskan request yang sah ke service tujuan dengan menyisipkan header `X-Gateway-Secret`. |
| **Policy Engine / Policy Administrator** | **PE / PA** | *(Modul Gateway)* | Modul internal di gateway. Menangani autentikasi login, menerbitkan dan mencabut token, serta memutuskan `ALLOW` / `DENY` berdasarkan aturan kebijakan, jam operasional, status kelas, dan kepemilikan data di database. |
| **Service Nilai** | **Resource Service** | `3001` | Mengelola data nilai dan kelas mata kuliah. Memverifikasi `X-Gateway-Secret` dan JWT secara mandiri. Saat finalisasi nilai kelas, memanggil Service Transkrip melalui Gateway menggunakan Token Service. |
| **Service Transkrip** | **Resource Service** | `3002` | Mengelola data transkrip akademik mahasiswa dan perhitungan IPK. Memverifikasi `X-Gateway-Secret` dan JWT. Endpoint sinkronisasi hanya dapat diakses menggunakan Token Service. |
| **Database Bersama** | **Resource / State Store** | SQLite | Satu database bersama (`data/database.sqlite`) dengan penegakan relasi integritas referensial (`PRAGMA foreign_keys = ON`). |
| **Audit Log** | **Data Source / Telemetry** | Tabel DB | Tabel `audit_logs` di database yang mencatat setiap keputusan akses dari Gateway. |

---

## 3. Data Awal (Seed Data) & Akun Uji

Sesuai ketentuan Bagian 5 PDF panduan praktikum, data awal mencakup minimal 1 admin, 2 dosen, 3 mahasiswa, dan 2 kelas yang diampu oleh dosen berbeda:

### A. Tabel Akun Pengguna & Perangkat Terdaftar:

| Username | Password | Role | Identifier (NIM / NIP) | Nama Lengkap | Device ID Terdaftar (`X-Device-ID`) | Keterangan Perangkat |
|---|---|---|---|---|---|---|
| `admin` | `admin123` | `admin` | `ADM001` | Administrator Akademik | `dev-admin-01` | Laptop Biro TI |
| `dosen_budi` | `dosen123` | `dosen` | `198501012010121001` | Budi Santoso, M.Kom. | `dev-dosen-budi` | MacBook Dosen |
| `dosen_siti` | `dosen123` | `dosen` | `198702022012122002` | Dr. Siti Aminah, M.T. | `dev-dosen-siti` | ThinkPad Dosen *(Pembanding)* |
| `mhs_ahmad` | `mhs123` | `mahasiswa` | `247006001` | Ahmad Fauzi | `dev-mhs-ahmad` | Laptop Mahasiswa |
| `mhs_rizki` | `mhs123` | `mahasiswa` | `247006002` | Rizki Pratama | `dev-mhs-rizki` | HP Mahasiswa *(Pembanding)* |
| `mhs_dewi` | `mhs123` | `mahasiswa` | `247006003` | Dewi Lestari | `dev-mhs-dewi` | Tablet Mahasiswa *(Pembanding)* |

> **Catatan Pengujian Device Binding:**  
> Gunakan Device ID `dev-hacker-hp` untuk menguji penolakan login (*401 Device Not Registered*).

### B. Data Kelas Mata Kuliah:
- **Kelas 1 (`IF2101`):** *Keamanan Informasi* (3 SKS) — Diampu oleh **`dosen_budi`** (Status: `DRAFT`). Memuat nilai awal Ahmad, Rizki, dan Dewi.
- **Kelas 2 (`IF2102`):** *Jaringan Komputer Lanjut* (3 SKS) — Diampu oleh **`dosen_siti`** (Status: `DRAFT`). Memuat nilai awal Ahmad, Rizki, dan Dewi.

---

## 4. Matriks Kebijakan Akses Endpoint (Tabel 3 Panduan Praktikum)

Semua endpoint wajib diakses melalui API Gateway (`http://localhost:3000`):

| Method & Path | Ditangani Oleh | Role Diizinkan | Kondisi / Aturan Kebijakan (ABAC & Konteks) |
|---|---|---|---|
| `POST /auth/login` | Gateway | Semua user | Kredensial valid (username & password) dan device terdaftar (`X-Device-ID`). |
| `POST /auth/refresh` | Gateway | Semua user | Refresh token valid, aktif, dan belum dicabut di database. |
| `POST /auth/logout` | Gateway | Semua user | Mencabut (*revoke*) refresh token aktif milik user di database. |
| `POST /auth/service` | Gateway | Service Nilai | Client ID dan Client Secret valid (Menghasilkan Service Token 5 menit, `role: service`). |
| `GET /nilai` | Service Nilai | Mahasiswa, Dosen | **Mahasiswa:** hanya melihat nilai miliknya sendiri.<br>**Dosen:** hanya melihat nilai kelas yang diampunya. |
| `PUT /nilai/:id` | Service Nilai | Dosen | Kelas yang diampu dosen, kelas/nilai belum `FINAL`, dan dilakukan dalam jam akses (07.00–21.00 WIB). |
| `POST /kelas/:id/finalisasi` | Service Nilai | Dosen | Kelas yang diampu dan dalam jam akses (07.00–21.00 WIB). Memanggil sinkronisasi transkrip via Gateway PEP. |
| `GET /transkrip/:nim` | Service Transkrip | Mahasiswa, Admin | **Mahasiswa:** hanya dapat melihat transkrip miliknya sendiri (*Anti-IDOR*).<br>**Admin:** dapat melihat transkrip seluruh NIM. |
| `POST /transkrip/sinkron` | Service Transkrip | Service Nilai | **Hanya token service** (`role: service`). Seluruh token user (`admin`, `dosen`, `mahasiswa`) **wajib ditolak (403)**. |

---

## 5. Implementasi Kebutuhan Sistem (Bagian 4 PDF)

### 4.1 Autentikasi dan Token
- **Access Token:** Menggunakan JSON Web Token (JWT) dengan masa aktif **10 menit**. Memuat payload `sub` (User ID), `role`, `nim`/`nip`, dan `jti`. Dikirimkan melalui header `Authorization: Bearer <token>`.
- **Refresh Token:** Berlaku **1 hari (24 jam)** dan disimpan di database pada tabel `refresh_tokens`. Saat user melakukan `POST /auth/logout`, token ini seketika di-revoke (`is_revoked = 1`).
- **Token Service:** Diperoleh Service Nilai melalui `POST /auth/service` menggunakan `client_id` dan `client_secret`. Berlaku **5 menit** dengan klaim `role: service` dan `sub: gateway-service`.
- **Gateway Secret:** Gateway menyisipkan header `X-Gateway-Secret` pada setiap request yang diteruskan ke service backend.
- **Verifikasi Ulang di Service (Defense-in-Depth):** Service Nilai dan Service Transkrip memeriksa keberadaan `X-Gateway-Secret` **DAN** memverifikasi tanda tangan serta masa berlaku token JWT secara mandiri. Request tanpa secret ditolak `403 Forbidden`, dan request tanpa token valid ditolak `401 Unauthorized`.

### 4.2 Kebijakan Akses (RBAC & ABAC)
- Penegakan kebijakan dilakukan oleh Policy Engine (`gateway/src/policy.js`) yang melakukan lookup ke database untuk memvalidasi atribut kepemilikan data (apakah dosen benar mengampu kelas tersebut, apakah mahasiswa pemilik sah NIM terkait).

### 4.3 Verifikasi Konteks
- **Device Binding:** Setiap request user wajib menyertakan header `X-Device-ID`. Jika ID perangkat tidak cocok dengan relasi perangkat akun di tabel `devices`, akses ditolak `401 Unauthorized`.
- **Jam Akses:** Operasi modifikasi nilai (`PUT /nilai/:id` dan `POST /kelas/:id/finalisasi`) dibatasi ketat hanya pada pukul **07.00 s.d. 21.00 WIB**. Mendukung simulasi waktu melalui header `X-Mock-Hour` untuk pengujian kapan saja.

### 4.4 Audit Logging
- Setiap evaluasi kebijakan di Gateway dicatat ke tabel `audit_logs` SQLite dengan skema:
  - `timestamp`: Waktu ISO 8601 UTC / WIB.
  - `subject`: Identitas pengguna (`user.id`) atau service (`service-nilai`).
  - `role`: Role subjek (`admin`, `dosen`, `mahasiswa`, `service`).
  - `endpoint`: HTTP Method dan Path tujuan (contoh: `PUT /nilai/1`).
  - `device_id`: Nilai header `X-Device-ID`.
  - `decision`: Keputusan akses (`ALLOW` atau `DENY`).
  - `reason`: Penjelasan alasan evaluasi kebijakan secara spesifik.

---

## 6. Panduan Instalasi & Menjalankan Sistem

### Prasyarat:
- **Node.js** (versi 18.x atau lebih baru)
- **NPM** (bawaan Node.js)

### Langkah 1: Kloning Repositori
```bash
git clone https://github.com/ripkimaulana1210-del/ZeroTrust.git
cd ZeroTrust
```

### Langkah 2: Pasang Dependencies
```bash
npm install
```

### Langkah 3: Konfigurasi Lingkungan (`.env`)
Salin konfigurasi dari `.env.example` ke file `.env`:
```bash
cp .env.example .env
```
Isi konfigurasi standar `.env`:
```env
GATEWAY_PORT=3000
NODE_ENV=development

SERVICE_NILAI_PORT=3001
SERVICE_TRANSKRIP_PORT=3002

GATEWAY_SECRET=dev-gateway-secret-key-3000-internal
JWT_SECRET=dev-jwt-super-secret-access-token-key

SERVICE_NILAI_CLIENT_ID=service-nilai
SERVICE_NILAI_CLIENT_SECRET=dev-service-nilai-client-secret-key

ACCESS_START_HOUR=7
ACCESS_END_HOUR=21

DATABASE_PATH=./data/database.sqlite
```

### Langkah 4: Inisialisasi Database SQLite
Jalankan migrasi skema tabel dan seed data awal:
```bash
npm run db:init
```
*(Catatan: Jalankan `npm run db:reset` jika ingin mengembalikan database ke kondisi bersih awal kapan saja).*

### Langkah 5: Menjalankan 3 Service Backend
Buka 3 jendela terminal terpisah:

- **Terminal 1 — API Gateway (Port 3000):**
  ```bash
  npm run start:gateway
  ```
- **Terminal 2 — Service Nilai (Port 3001):**
  ```bash
  npm run start:nilai
  ```
- **Terminal 3 — Service Transkrip (Port 3002):**
  ```bash
  npm run start:transkrip
  ```

### Langkah 6: Mengakses Web Portal SIAKAD
Buka browser pada alamat:
```text
http://localhost:3000/
```
Antarmuka Web Portal SIAKAD menyediakan:
- Tombol **Quick-Fill Akun Demo** untuk semua peran (Dosen Budi, Dosen Siti, Mhs Ahmad, Mhs Rizki, Mhs Dewi, dan Admin).
- Dropdown simulasi **Device Binding** (Perangkat Resmi vs Perangkat Asing `dev-hacker-hp`).
- Tombol pengujian **Direct Access Rejection (Bypass Port 3001)**.
- Form pengubahan nilai mahasiswa (0–100 dan A–E) serta tombol **Finalisasi Nilai Kelas**.
- Tombol uji coba **Cross-Dosen Tampering** dan **Token User ke Sync S2S**.
- Workspace Mahasiswa dengan tampilan KHS, IPK kumulatif, dan kartu uji coba **Anti-IDOR**.
- Workspace Admin dengan fitur pencarian transkrip seluruh NIM.
- Streaming tabel **Audit Log Keamanan SQLite** secara real-time.

---

## 7. Panduan Pengujian Sistem

### A. Pengujian Otomatis (*Automated Test Suite*)
Proyek telah dilengkapi dengan 62 skenario pengujian unit dan integrasi yang memvalidasi seluruh ketentuan tugas praktikum:
```bash
npm test
```
**Hasil Eksekusi Test:**
```text
✔ 62 tests passed
✔ 0 tests failed
```
Cakupan pengujian meliputi: validasi JWT, rotasi refresh token, device binding, anti-IDOR, batasan jam akses, penolakan akses langsung, dan sinkronisasi S2S.

---

### B. Pengujian Manual Menggunakan cURL

Berikut adalah panduan eksekusi cURL untuk mendemokan skenario keamanan:

#### 1. Uji Penolakan Direct Access (Port 3001 & 3002)
Akses langsung ke service internal tanpa melewati Gateway akan ditolak:
```bash
# Uji panggil langsung Service Nilai (Port 3001)
curl -i http://localhost:3001/nilai

# Uji panggil langsung Service Transkrip (Port 3002)
curl -i http://localhost:3002/transkrip/247006001
```
*(Menghasilkan: `HTTP/1.1 403 Forbidden` dengan pesan penolakan akses langsung)*.

#### 2. Uji Autentikasi & Device Binding (`POST /auth/login`)
- **Login Sukses (Device Terdaftar):**
  ```bash
  curl -i -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -H "X-Device-ID: dev-dosen-budi" \
    -d "{\"username\":\"dosen_budi\",\"password\":\"dosen123\"}"
  ```
  *(Menghasilkan: `200 OK` beserta `accessToken` dan `refreshToken`)*.

- **Login Gagal (Device Asing / Tidak Terdaftar):**
  ```bash
  curl -i -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -H "X-Device-ID: dev-hacker-hp" \
    -d "{\"username\":\"dosen_budi\",\"password\":\"dosen123\"}"
  ```
  *(Menghasilkan: `401 Unauthorized` — Device not registered)*.

#### 3. Uji Hak Akses Dosen & Kepemilikan Data (`PUT /nilai/:id`)
- **Dosen Budi mengubah nilai pada kelasnya (IF2101):**
  ```bash
  curl -i -X PUT http://localhost:3000/nilai/1 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <TOKEN_DOSEN_BUDI>" \
    -H "X-Device-ID: dev-dosen-budi" \
    -d "{\"nilai_angka\":90,\"nilai_huruf\":\"A\"}"
  ```
  *(Menghasilkan: `200 OK` — Nilai berhasil diubah)*.

- **Dosen Budi mencoba mengubah nilai kelas Dosen Siti (IF2102):**
  ```bash
  curl -i -X PUT http://localhost:3000/nilai/4 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <TOKEN_DOSEN_BUDI>" \
    -H "X-Device-ID: dev-dosen-budi" \
    -d "{\"nilai_angka\":95,\"nilai_huruf\":\"A\"}"
  ```
  *(Menghasilkan: `403 Forbidden` — Dosen hanya diizinkan mengubah nilai pada kelas yang diampunya)*.

#### 4. Uji Finalisasi Nilai Kelas & Sinkronisasi S2S (`POST /kelas/:id/finalisasi`)
```bash
curl -i -X POST http://localhost:3000/kelas/1/finalisasi \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_DOSEN_BUDI>" \
  -H "X-Device-ID: dev-dosen-budi" \
  -d "{}"
```
*(Menghasilkan: `200 OK`. Service Nilai meminta Service Token 5 menit ke Gateway PEP, lalu menyinkronkan data ke Service Transkrip. Kelas berubah menjadi `FINAL`)*.

- **Uji Immutability (Mencoba ubah nilai kelas yang sudah FINAL):**
  ```bash
  curl -i -X PUT http://localhost:3000/nilai/1 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <TOKEN_DOSEN_BUDI>" \
    -H "X-Device-ID: dev-dosen-budi" \
    -d "{\"nilai_angka\":99,\"nilai_huruf\":\"A\"}"
  ```
  *(Menghasilkan: `403 Forbidden` — Nilai tidak dapat diubah karena kelas sudah berstatus FINAL)*.

#### 5. Uji Proteksi Endpoint Sinkronisasi Khusus Service (`POST /transkrip/sinkron`)
Mencoba memanggil sinkronisasi menggunakan token user biasa:
```bash
curl -i -X POST http://localhost:3000/transkrip/sinkron \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN_USER>" \
  -H "X-Device-ID: dev-dosen-budi" \
  -d "{\"kelasId\":1}"
```
*(Menghasilkan: `403 Forbidden` — Hanya token service yang diizinkan)*.

#### 6. Uji Anti-IDOR pada Mahasiswa (`GET /transkrip/:nim`)
- **Mahasiswa Ahmad melihat transkrip miliknya sendiri (247006001):**
  ```bash
  curl -i http://localhost:3000/transkrip/247006001 \
    -H "Authorization: Bearer <TOKEN_MHS_AHMAD>" \
    -H "X-Device-ID: dev-mhs-ahmad"
  ```
  *(Menghasilkan: `200 OK` beserta rincian KHS dan IPK)*.

- **Mahasiswa Ahmad mencoba mengintip transkrip Mahasiswa Rizki (247006002):**
  ```bash
  curl -i http://localhost:3000/transkrip/247006002 \
    -H "Authorization: Bearer <TOKEN_MHS_AHMAD>" \
    -H "X-Device-ID: dev-mhs-ahmad"
  ```
  *(Menghasilkan: `403 Forbidden` — Mahasiswa hanya diizinkan melihat transkrip dengan NIM miliknya sendiri)*.

- **Admin melihat transkrip mahasiswa mana pun:**
  ```bash
  curl -i http://localhost:3000/transkrip/247006002 \
    -H "Authorization: Bearer <TOKEN_ADMIN>" \
    -H "X-Device-ID: dev-admin-01"
  ```
  *(Menghasilkan: `200 OK` — Admin memiliki hak istimewa untuk memeriksa seluruh NIM)*.

#### 7. Uji Revokasi Refresh Token saat Logout (`POST /auth/logout`)
```bash
curl -i -X POST http://localhost:3000/auth/logout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "X-Device-ID: <DEVICE_ID>" \
  -d "{\"refreshToken\":\"<REFRESH_TOKEN>\"}"
```
*(Menghasilkan: `200 OK`. Mencoba menggunakan refresh token yang telah di-revoke untuk request `/auth/refresh` akan ditolak)*.

---

## 8. Pemetaan Lokasi Kode Sumber (Code Source Mapping)

Untuk mempermudah penilaian dan review kode oleh dosen penguji, berikut adalah pemetaan file yang bertanggung jawab atas setiap kebutuhan:

| Kebutuhan Tugas | Komponen | File Kode Sumber | Fungsi / Logika Kunci |
|---|---|---|---|
| **PEP (Policy Enforcement Point)** | Gateway | `gateway/src/middleware/pep.js` | Mencegat semua request, validasi header `X-Device-ID`, verifikasi signature JWT, cek status token dicabut di DB. |
| **Policy Engine (Evaluasi Kebijakan)** | Gateway | `gateway/src/policy.js` | Fungsi `evaluate()` yang menerapkan seluruh matriks aturan RBAC/ABAC (Tabel 3). |
| **Device Binding & Konteks** | Gateway | `gateway/src/policy.js` | Lookup relasi tabel `devices` untuk memastikan ID perangkat terdaftar resmi. |
| **Pembatasan Jam Akses (07–21 WIB)** | Gateway | `gateway/src/policy.js` | Fungsi `isWithinAccessHours()` dengan zona waktu `Asia/Jakarta`. |
| **Token Issuer & Revokasi** | Gateway | `gateway/src/tokens.js`, `gateway/src/auth.js` | Pembuatan Access Token (10m), Refresh Token (24h), Service Token (5m), dan revokasi logout. |
| **Reverse Proxy HTTP & Forward Secret** | Gateway | `gateway/src/app.js` | Penggunaan `http-proxy-middleware` dengan penyisipan header rahasia `X-Gateway-Secret`. |
| **Defense-in-Depth Service Nilai** | Service Nilai | `services/nilai/app.js` | Validasi mandiri `X-Gateway-Secret` dan verifikasi JWT token lokal. |
| **Trigger Sinkronisasi S2S** | Service Nilai | `services/nilai/app.js` | Meminta Service Token ke Gateway lalu memanggil Service Transkrip via Gateway PEP. |
| **Defense-in-Depth Service Transkrip** | Service Transkrip | `services/transkrip/app.js` | Validasi mandiri `X-Gateway-Secret`, pembatasan endpoint `/transkrip/sinkron` khusus `role: service`. |
| **Audit Logging** | Gateway | `gateway/src/audit.js` | Menulis setiap evaluasi keputusan `ALLOW` dan `DENY` ke tabel `audit_logs` SQLite. |
| **Skema Database & Seed Data** | Database | `database/schema.js`, `database/seed.js` | DDL tabel dan seeding data awal 6 pengguna, perangkat, kelas, dan nilai. |

---

## 9. Panduan Rundown Video Demo Praktikum (Durasi 6–9 Menit)

Sesuai ketentuan Luaran Bagian 6 nomor 2, berikut alur video demo yang direkomendasikan:

| Menit | Segmen Demo | Hal yang Ditunjukkan & Dijelaskan |
|---|---|---|
| **00:00 – 01:00** | **Pembuka & Arsitektur Sistem** | Salam pembuka, identitas (Nama & NIM), penjelasan arsitektur NIST SP 800-207 (Gateway PEP port 3000, Service Nilai 3001, Service Transkrip 3002, dan SQLite bersama). |
| **01:00 – 02:00** | **Uji Direct Access Bypass (Defense-in-Depth)** | Klik tombol merah bypass port 3001 di portal. Tunjukkan respon ditolak `403 Forbidden` karena tidak membawa `X-Gateway-Secret`. |
| **02:00 – 03:15** | **Uji Device Binding & Autentikasi** | Login dengan akun Dosen Budi menggunakan perangkat asing `dev-hacker-hp` (ditolak `401 Unauthorized`). Ganti ke perangkat resmi `dev-dosen-budi` (berhasil login dan menerima JWT 10 menit). |
| **03:15 – 04:30** | **Uji Least Privilege Dosen (ABAC Ownership)** | Dosen Budi mengubah nilai mahasiswa di kelas IF2101 (berhasil). Dosen Budi mencoba mengubah nilai kelas IF2102 milik Dosen Siti (ditolak `403 Forbidden`). |
| **04:30 – 05:45** | **Uji Finalisasi, S2S Token & Immutability** | Eksekusi tombol finalisasi kelas IF2101. Jelaskan Service Nilai meminta Service Token 5 menit untuk sinkronisasi ke Transkrip via Gateway PEP. Nilai terkunci permanen (*Immutable*). Tunjukkan uji coba token user ke endpoint sinkronisasi ditolak `403`. |
| **05:45 – 06:45** | **Uji Mahasiswa & Anti-IDOR** | Login sebagai Mahasiswa Ahmad (NIM 247006001). Tunjukkan KHS Ahmad. Coba serang dengan mengintip transkrip Mahasiswa Rizki (NIM 247006002) — ditolak `403 Forbidden`. |
| **06:45 – 07:45** | **Penjelasan Kode Sumber di VS Code** | Buka VS Code: tunjukkan `gateway/src/middleware/pep.js` (PEP), `gateway/src/policy.js` (Policy Engine & jam akses), dan `services/nilai/app.js` (Defense-in-depth secret). |
| **07:45 – 08:30** | **Audit Log & Hasil Test Otomatis** | Tunjukkan tabel Audit Log di portal yang mencatat seluruh riwayat `ALLOW` dan `DENY`. Buka terminal dan jalankan `npm test` — tunjukkan seluruh 62 pengujian lulus 100%. Penutup. |

---

## 10. Struktur Direktori Proyek

```
ZeroTrust/
├── data/
│   └── .gitkeep                 # Folder database SQLite lokal
├── database/
│   ├── connection.js            # Koneksi better-sqlite3 & PRAGMA foreign_keys = ON
│   ├── init.js                  # Skrip migrasi skema tabel & seed data awal
│   ├── reset.js                 # Skrip reset database ke kondisi awal
│   ├── schema.js                # Definisi DDL tabel & indeks
│   └── seed.js                  # Data awal 6 user, perangkat, kelas, dan nilai
├── docs/                        # Dokumentasi teknis & catatan pengujian
├── frontend/
│   ├── index.html               # Web Portal SIAKAD (UI Pengujian Interaktif)
│   └── app.js                   # Logika frontend, pemanggil API, & penanganan sesi
├── gateway/
│   ├── index.js                 # Entrypoint server API Gateway (Port 3000)
│   └── src/
│       ├── app.js               # Reverse Proxy HTTP & routing auth
│       ├── audit.js             # Perekam telemetri ke tabel audit_logs
│       ├── auth.js              # Endpoint login, refresh, logout, service auth
│       ├── policy.js            # Policy Engine (evaluasi aturan RBAC/ABAC)
│       ├── tokens.js            # Generator & verifikator JWT
│       └── middleware/pep.js    # Policy Enforcement Point (PEP)
├── services/
│   ├── nilai/
│   │   ├── app.js               # Service Nilai & trigger S2S finalisasi
│   │   └── index.js             # Entrypoint Service Nilai (Port 3001)
│   └── transkrip/
│       ├── app.js               # Service Transkrip & endpoint sinkronisasi S2S
│       ├── repository.js        # Perhitungan IPK & query transkrip
│       └── index.js             # Entrypoint Service Transkrip (Port 3002)
├── tests/                       # Automated Test Suite (62 unit & integration tests)
├── .env.example                 # Template konfigurasi environment
├── .gitignore                   # Konfigurasi file yang diabaikan oleh Git
├── package.json                 # Skrip NPM dan daftar dependencies
├── PROJECT_CONTEXT.md           # Acuan teknis arsitektur & kebijakan
└── README.md                    # Dokumentasi utama proyek
```
