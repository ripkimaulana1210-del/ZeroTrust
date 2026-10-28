# Komponen API Gateway & Policy Engine (NIST SP 800-207)

Komponen ini memuat modul **Policy Administrator (PA)**, **Policy Engine (PE)**, dan **Audit Logger** yang menjadi otak kontrol akses arsitektur Zero Trust.

---

## 1. Modul yang Tersedia di `gateway/src/`

### 1. `tokens.js` (Manajemen Token JWT)
- **`generateAccessToken(user)`**: Menerbitkan Access Token JWT dengan masa berlaku 10 menit. Menyertakan claim wajib: `sub` (User ID), `username`, `role`, `identifier` (NPM/NIP), dan `type: 'user'`.
- **`generateServiceToken(clientId)`**: Menerbitkan Service Token JWT dengan masa berlaku 5 menit dan claim `role: 'service'`, `type: 'service'`.
- **`generateRefreshToken()`**: Menghasilkan 40-byte random string token dan `jti` (UUID) dengan masa berlaku 24 jam.
- **`hashToken(token)`**: Melakukan hashing SHA-256 terhadap token mentah sebelum disimpan di tabel `refresh_tokens`.
- **`verifyToken(token, secret)`**: Memvalidasi signature, masa berlaku, dan integritas format token.

### 2. `auth.js` (Policy Administrator)
- **`login(db, { username, password, deviceId })`**: Memvalidasi kredensial pengguna via bcrypt hash dan memverifikasi apakah `deviceId` (`X-Device-ID`) aktif dan terdaftar untuk pengguna tersebut. Menerbitkan access token dan menyimpan hash refresh token di database.
- **`refresh(db, { refreshToken, deviceId })`**: Menerapkan **Refresh Token Rotation**. Memvalidasi hash token, memastikan token belum kedaluwarsa dan belum dicabut (`revoked = 0`). Token lama dicabut, lalu diterbitkan access token baru dan refresh token baru.
- **`logout(db, { refreshToken })`**: Mencabut (*revoked = 1*) sesi refresh token di database (*instant revocation*).
- **`authenticateService({ clientId, clientSecret })`**: Memvalidasi kredensial service dari environment (`SERVICE_NILAI_CLIENT_ID` dan `SERVICE_NILAI_CLIENT_SECRET`) dan menerbitkan Service Token 5 menit.

### 3. `policy.js` (Policy Engine)
- **`evaluatePolicy(db, { subject, action, resource, context })`**:
  Menerapkan evaluasi berbasis atribut (ABAC) dan konteks:
  - Memverifikasi kehadiran dan validitas identitas `subject`.
  - Memverifikasi apakah perangkat (`X-Device-ID`) terikat secara sah pada pengguna di tabel `devices`.
  - Membatasi modifikasi/finalisasi nilai pada jam operasional (07.00–21.00 WIB).
  - Menegakkan kepemilikan kelas oleh Dosen (`kelas.dosen_id === subject.sub`).
  - Menegakkan imutabilitas kelas berstatus `FINAL`.
  - Melindungi data mahasiswa dari IDOR (`transkrip/:nim` hanya dapat diakses oleh pemilik NIM atau Admin).
  - Mengisolasi endpoint sinkronisasi transkrip (`POST /transkrip/sinkron`) khusus untuk Token Service (`role: 'service'`).

### 4. `audit.js` (Audit Logger)
- **`recordAudit(db, entry)`**: Menyimpan setiap keputusan `ALLOW` dan `DENY` beserta subjek, role, endpoint, method, device_id, timestamp, dan alasannya ke dalam tabel `audit_logs`.
- **`getAuditLogs(db, filters)`**: Membaca catatan riwayat audit untuk inspeksi kepatuhan.

---

## 2. Pengujian Unit

Seluruh fungsi modul ini telah diuji secara menyeluruh menggunakan `node:test`:
```bash
npm test
# atau: node --test tests/auth_policy.test.js
```
