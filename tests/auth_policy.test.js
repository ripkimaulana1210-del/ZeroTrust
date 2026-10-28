const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Tests provide isolated deterministic credentials. Production code has no fallback secret.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-never-use-outside-tests';
process.env.SERVICE_NILAI_CLIENT_SECRET = process.env.SERVICE_NILAI_CLIENT_SECRET || 'test-only-service-secret';
process.env.SERVICE_NILAI_CLIENT_ID = process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai';
require('dotenv').config();
const { getDatabase } = require('../database/connection');
const { runMigrations } = require('../database/schema');
const { seedDatabase } = require('../database/seed');
const {
  generateAccessToken,
  generateServiceToken,
  verifyToken,
  hashToken
} = require('../gateway/src/tokens');
const {
  login,
  refresh,
  logout,
  authenticateService
} = require('../gateway/src/auth');
const { evaluatePolicy } = require('../gateway/src/policy');
const { recordAudit, getAuditLogs } = require('../gateway/src/audit');

describe('Modul Autentikasi, Tokens, Policy Engine & Audit Log', () => {
  let db;

  beforeEach(() => {
    // Database in-memory terisolasi untuk setiap pengujian
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db);
  });

  /* -------------------------------------------------------------
   * 1. PENGUJIAN AUTENTIKASI PENGGUNA & LOGIN
   * ------------------------------------------------------------- */
  describe('1. Alur Autentikasi Pengguna & Login', () => {
    it('Harus berhasil login dengan kredensial benar dan device terdaftar', () => {
      const res = login(db, {
        username: 'mhs_ahmad',
        password: 'mhs123',
        deviceId: 'dev-mhs-ahmad'
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.accessToken, 'Harus mengembalikan accessToken');
      assert.ok(res.refreshToken, 'Harus mengembalikan refreshToken');
      assert.strictEqual(res.user.username, 'mhs_ahmad');
      assert.strictEqual(res.user.role, 'mahasiswa');
      assert.strictEqual(res.user.identifier, '247006001');

      // Pastikan hash refresh token tersimpan di database
      const tokenHash = hashToken(res.refreshToken);
      const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?;').get(tokenHash);
      assert.ok(row, 'Hash refresh token wajib ada di tabel refresh_tokens');
      assert.strictEqual(row.revoked, 0, 'Status refresh token harus aktif (revoked = 0)');
    });

    it('Harus menolak login dengan password yang salah', () => {
      const res = login(db, {
        username: 'mhs_ahmad',
        password: 'password_salah',
        deviceId: 'dev-mhs-ahmad'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'INVALID_CREDENTIALS');
    });

    it('Harus menolak login jika username tidak ditemukan', () => {
      const res = login(db, {
        username: 'user_tidak_dikenal',
        password: 'password123',
        deviceId: 'dev-mhs-ahmad'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'INVALID_CREDENTIALS');
    });

    it('Harus menolak login jika device tidak terdaftar untuk pengguna tersebut', () => {
      // dev-mhs-rizki milik rizki, bukan ahmad
      const res = login(db, {
        username: 'mhs_ahmad',
        password: 'mhs123',
        deviceId: 'dev-mhs-rizki'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'UNREGISTERED_DEVICE');
    });

    it('Harus menolak login jika deviceId tidak disertakan', () => {
      const res = login(db, {
        username: 'mhs_ahmad',
        password: 'mhs123'
      });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error, 'MISSING_DEVICE_ID');
    });
  });

  /* -------------------------------------------------------------
   * 2. PENGUJIAN ACCESS TOKEN & SERVICE TOKEN VERIFIKASI
   * ------------------------------------------------------------- */
  describe('2. Verifikasi Integritas JWT & Expiry', () => {
    it('Harus berhasil memverifikasi Access Token yang sah', () => {
      const user = { id: 1, username: 'admin', role: 'admin', identifier: 'ADM001' };
      const token = generateAccessToken(user);

      const verification = verifyToken(token);
      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.payload.sub, 1);
      assert.strictEqual(verification.payload.role, 'admin');
      assert.strictEqual(verification.payload.type, 'user');
    });

    it('Harus menolak token dengan tanda tangan (signature) yang dipalsukan', () => {
      const user = { id: 2, username: 'dosen_budi', role: 'dosen', identifier: '19850101' };
      const fakeToken = generateAccessToken(user);
      // Verifikasi menggunakan secret yang salah
      const verification = verifyToken(fakeToken, 'kunci-rahasia-palsu-lainnya');

      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.error, 'TOKEN_INVALID');
    });

    it('Harus menolak token yang telah kedaluwarsa (expired)', () => {
      const user = { id: 2, username: 'dosen_budi', role: 'dosen', identifier: '19850101' };
      // Terbitkan token dengan durasi kedaluwarsa 0 detik
      const expiredToken = generateAccessToken(user, '0s');

      const verification = verifyToken(expiredToken);
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.error, 'TOKEN_EXPIRED');
    });

    it('Harus menolak format token yang cacat (malformed)', () => {
      const verification = verifyToken('header.payload.bukan-signature-valid');
      assert.strictEqual(verification.valid, false);
      assert.strictEqual(verification.error, 'TOKEN_INVALID');
    });
  });

  /* -------------------------------------------------------------
   * 3. PENGUJIAN REFRESH TOKEN ROTATION & REVOCATION
   * ------------------------------------------------------------- */
  describe('3. Rotasi Refresh Token & Revokasi Logout', () => {
    it('Harus berhasil melakukan refresh token rotation dan mencabut token lama', () => {
      // 1. Login awal
      const loginRes = login(db, {
        username: 'mhs_ahmad',
        password: 'mhs123',
        deviceId: 'dev-mhs-ahmad'
      });
      const oldRefreshToken = loginRes.refreshToken;

      // 2. Lakukan refresh
      const refreshRes = refresh(db, {
        refreshToken: oldRefreshToken,
        deviceId: 'dev-mhs-ahmad'
      });

      assert.strictEqual(refreshRes.success, true);
      assert.ok(refreshRes.accessToken, 'Harus menerbitkan access token baru');
      assert.ok(refreshRes.refreshToken, 'Harus menerbitkan refresh token baru');
      assert.notStrictEqual(refreshRes.refreshToken, oldRefreshToken, 'Refresh token baru harus berbeda (rotasi)');

      // 3. Pastikan token lama berstatus revoked = 1 di database
      const oldHash = hashToken(oldRefreshToken);
      const oldRow = db.prepare('SELECT revoked FROM refresh_tokens WHERE token_hash = ?;').get(oldHash);
      assert.strictEqual(oldRow.revoked, 1, 'Token lama harus ditandai revoked = 1');

      // 4. Pastikan token baru berstatus revoked = 0
      const newHash = hashToken(refreshRes.refreshToken);
      const newRow = db.prepare('SELECT revoked FROM refresh_tokens WHERE token_hash = ?;').get(newHash);
      assert.strictEqual(newRow.revoked, 0, 'Token baru harus berstatus aktif (revoked = 0)');

      // 5. Coba gunakan kembali token lama (Replay Attack) -> Harus ditolak
      const reuseRes = refresh(db, {
        refreshToken: oldRefreshToken,
        deviceId: 'dev-mhs-ahmad'
      });
      assert.strictEqual(reuseRes.success, false);
      assert.strictEqual(reuseRes.error, 'TOKEN_REVOKED', 'Penggunaan ulang token yang telah dirotasi wajib ditolak');
    });

    it('Harus mencabut refresh token saat pengguna logout', () => {
      const loginRes = login(db, {
        username: 'dosen_budi',
        password: 'dosen123',
        deviceId: 'dev-dosen-budi'
      });

      const logoutRes = logout(db, { refreshToken: loginRes.refreshToken });
      assert.strictEqual(logoutRes.success, true);

      // Coba lakukan refresh setelah logout -> Harus ditolak
      const refreshAfterLogout = refresh(db, {
        refreshToken: loginRes.refreshToken,
        deviceId: 'dev-dosen-budi'
      });
      assert.strictEqual(refreshAfterLogout.success, false);
      assert.strictEqual(refreshAfterLogout.error, 'TOKEN_REVOKED');
    });
  });

  /* -------------------------------------------------------------
   * 4. PENGUJIAN SERVICE AUTHENTICATION (SERVICE-TO-SERVICE)
   * ------------------------------------------------------------- */
  describe('4. Autentikasi Service-to-Service', () => {
    it('Harus berhasil menerbitkan Service Token dengan client ID dan secret valid', () => {
      const authRes = authenticateService({
        clientId: 'service-nilai',
        clientSecret: process.env.SERVICE_NILAI_CLIENT_SECRET || 'dev-service-nilai-client-secret-key'
      });

      assert.strictEqual(authRes.success, true);
      assert.ok(authRes.serviceToken);

      const verification = verifyToken(authRes.serviceToken);
      assert.strictEqual(verification.valid, true);
      assert.strictEqual(verification.payload.sub, 'service-nilai');
      assert.strictEqual(verification.payload.role, 'service');
      assert.strictEqual(verification.payload.type, 'service');
    });

    it('Harus menolak autentikasi service dengan client secret salah', () => {
      const authRes = authenticateService({
        clientId: 'service-nilai',
        clientSecret: 'secret_salah_total'
      });

      assert.strictEqual(authRes.success, false);
      assert.strictEqual(authRes.error, 'INVALID_SERVICE_CREDENTIALS');
    });
  });

  /* -------------------------------------------------------------
   * 5. PENGUJIAN POLICY ENGINE (ABAC & CONTEXT ENFORCEMENT)
   * ------------------------------------------------------------- */
  describe('5. Penegakan Kebijakan Policy Engine (PE)', () => {
    const dosenBudi = { sub: 2, username: 'dosen_budi', role: 'dosen', identifier: '19850101', type: 'user' };
    const dosenSiti = { sub: 3, username: 'dosen_siti', role: 'dosen', identifier: '19870202', type: 'user' };
    const mhsAhmad = { sub: 4, username: 'mhs_ahmad', role: 'mahasiswa', identifier: '247006001', type: 'user' };
    const adminUser = { sub: 1, username: 'admin', role: 'admin', identifier: 'ADM001', type: 'user' };
    const serviceNilai = { sub: 'service-nilai', role: 'service', type: 'service' };

    // Device Context
    it('Harus menolak request user tanpa header X-Device-ID', () => {
      const decision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'GET',
        resource: '/nilai',
        context: {} // deviceId tidak ada
      });

      assert.strictEqual(decision.decision, 'DENY');
      assert.match(decision.reason, /X-Device-ID/);
    });

    it('Harus menolak request user jika device tidak cocok dengan kepemilikan di database', () => {
      const decision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'GET',
        resource: '/nilai',
        context: { deviceId: 'dev-dosen-budi' } // device milik dosen budi, bukan ahmad
      });

      assert.strictEqual(decision.decision, 'DENY');
      assert.match(decision.reason, /Perangkat tidak terdaftar/);
    });

    // GET /nilai
    it('Mahasiswa dan Dosen diizinkan mengakses GET /nilai dengan scope masing-masing', () => {
      const mhsDecision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'GET',
        resource: '/nilai',
        context: { deviceId: 'dev-mhs-ahmad' }
      });
      assert.strictEqual(mhsDecision.decision, 'ALLOW');

      const dosenDecision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'GET',
        resource: '/nilai',
        context: { deviceId: 'dev-dosen-budi' }
      });
      assert.strictEqual(dosenDecision.decision, 'ALLOW');

      const adminDecision = evaluatePolicy(db, {
        subject: adminUser,
        action: 'GET',
        resource: '/nilai',
        context: { deviceId: 'dev-admin-01' }
      });
      assert.strictEqual(adminDecision.decision, 'DENY', 'Admin tidak memiliki hak akses pada GET /nilai');
    });

    // PUT /nilai/:id — Dosen, Jam Akses & Kepemilikan Kelas
    it('Dosen pengampu diizinkan mengubah nilai pada kelas ampuannya dalam jam kerja (07.00–21.00 WIB)', () => {
      // Nilai ID 1 berada di kelas IF2101 yang diampu dosen_budi (sub: 2)
      const decision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'PUT',
        resource: '/nilai/1',
        context: {
          deviceId: 'dev-dosen-budi',
          params: { id: '1' },
          currentHour: 10 // Pukul 10.00 WIB (dalam rentang jam)
        }
      });

      assert.strictEqual(decision.decision, 'ALLOW');
    });

    it('Harus menolak perubahan nilai jika dilakukan di luar jam kerja (misal pukul 22.00 WIB)', () => {
      const decision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'PUT',
        resource: '/nilai/1',
        context: {
          deviceId: 'dev-dosen-budi',
          params: { id: '1' },
          currentHour: 22 // Pukul 22.00 WIB (di luar rentang 07.00–21.00)
        }
      });

      assert.strictEqual(decision.decision, 'DENY');
      assert.match(decision.reason, /jam akses/);
    });

    it('Harus menolak jika Dosen lain mencoba mengubah nilai kelas yang bukan diampunya (Ownership Protection)', () => {
      // Nilai ID 1 diampu oleh dosen_budi, dosen_siti mencoba mengubah
      const decision = evaluatePolicy(db, {
        subject: dosenSiti,
        action: 'PUT',
        resource: '/nilai/1',
        context: {
          deviceId: 'dev-dosen-siti',
          params: { id: '1' },
          currentHour: 10
        }
      });

      assert.strictEqual(decision.decision, 'DENY');
      assert.match(decision.reason, /hanya diizinkan mengubah nilai pada kelas yang diampunya/);
    });

    it('Harus menolak perubahan nilai jika kelas sudah berstatus FINAL (Immutability)', () => {
      // Ubah status kelas menjadi FINAL di database
      db.prepare("UPDATE kelas SET status = 'FINAL' WHERE id = 1;").run();

      const decision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'PUT',
        resource: '/nilai/1',
        context: {
          deviceId: 'dev-dosen-budi',
          params: { id: '1' },
          currentHour: 10
        }
      });

      assert.strictEqual(decision.decision, 'DENY');
      assert.match(decision.reason, /sudah berstatus FINAL/);
    });

    // POST /kelas/:id/finalisasi
    it('Dosen pengampu diizinkan memfinalisasi kelas dalam jam akses', () => {
      const decision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'POST',
        resource: '/kelas/1/finalisasi',
        context: {
          deviceId: 'dev-dosen-budi',
          params: { id: '1' },
          currentHour: 14 // Pukul 14.00 WIB
        }
      });

      assert.strictEqual(decision.decision, 'ALLOW');
    });

    // GET /transkrip/:nim — IDOR Protection & Admin Access
    it('Mahasiswa hanya diizinkan melihat transkrip miliknya sendiri (IDOR Protection)', () => {
      // Mahasiswa Ahmad melihat transkrip NIM sendiri
      const ownDecision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'GET',
        resource: '/transkrip/247006001',
        context: {
          deviceId: 'dev-mhs-ahmad',
          params: { nim: '247006001' }
        }
      });
      assert.strictEqual(ownDecision.decision, 'ALLOW');

      // Mahasiswa Ahmad mencoba melihat transkrip Mahasiswa Rizki (247006002)
      const otherDecision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'GET',
        resource: '/transkrip/247006002',
        context: {
          deviceId: 'dev-mhs-ahmad',
          params: { nim: '247006002' }
        }
      });
      assert.strictEqual(otherDecision.decision, 'DENY');
      assert.match(otherDecision.reason, /NIM miliknya sendiri/);
    });

    it('Admin diizinkan melihat transkrip seluruh mahasiswa', () => {
      const adminDecision = evaluatePolicy(db, {
        subject: adminUser,
        action: 'GET',
        resource: '/transkrip/247006001',
        context: {
          deviceId: 'dev-admin-01',
          params: { nim: '247006001' }
        }
      });
      assert.strictEqual(adminDecision.decision, 'ALLOW');
    });

    // POST /transkrip/sinkron — Service-to-Service Isolation
    it('Hanya Token Service yang diizinkan mengakses POST /transkrip/sinkron', () => {
      const serviceDecision = evaluatePolicy(db, {
        subject: serviceNilai,
        action: 'POST',
        resource: '/transkrip/sinkron',
        context: {}
      });
      assert.strictEqual(serviceDecision.decision, 'ALLOW');

      // Seluruh user token wajib ditolak
      const adminDecision = evaluatePolicy(db, {
        subject: adminUser,
        action: 'POST',
        resource: '/transkrip/sinkron',
        context: { deviceId: 'dev-admin-01' }
      });
      assert.strictEqual(adminDecision.decision, 'DENY');

      const dosenDecision = evaluatePolicy(db, {
        subject: dosenBudi,
        action: 'POST',
        resource: '/transkrip/sinkron',
        context: { deviceId: 'dev-dosen-budi' }
      });
      assert.strictEqual(dosenDecision.decision, 'DENY');

      const mhsDecision = evaluatePolicy(db, {
        subject: mhsAhmad,
        action: 'POST',
        resource: '/transkrip/sinkron',
        context: { deviceId: 'dev-mhs-ahmad' }
      });
      assert.strictEqual(mhsDecision.decision, 'DENY');
    });
  });

  /* -------------------------------------------------------------
   * 6. PENGUJIAN AUDIT LOGGER
   * ------------------------------------------------------------- */
  describe('6. Pencatatan Audit Logger', () => {
    it('Harus menyimpan keputusan ALLOW dan DENY secara akurat ke database', () => {
      recordAudit(db, {
        subject: 'mhs_ahmad',
        role: 'mahasiswa',
        endpoint: '/nilai',
        method: 'GET',
        deviceId: 'dev-mhs-ahmad',
        decision: 'ALLOW',
        reason: 'Akses nilai diizinkan'
      });

      recordAudit(db, {
        subject: 'mhs_ahmad',
        role: 'mahasiswa',
        endpoint: '/transkrip/247006002',
        method: 'GET',
        deviceId: 'dev-mhs-ahmad',
        decision: 'DENY',
        reason: 'Mahasiswa hanya diizinkan melihat transkrip dengan NIM miliknya sendiri'
      });

      const logs = getAuditLogs(db);
      assert.strictEqual(logs.length, 2);

      const denyLog = logs.find(l => l.decision === 'DENY');
      assert.ok(denyLog);
      assert.strictEqual(denyLog.subject, 'mhs_ahmad');
      assert.strictEqual(denyLog.endpoint, '/transkrip/247006002');
      assert.match(denyLog.reason, /NIM miliknya sendiri/);

      // Verifikasi tidak ada field berbahaya atau secret yang tersimpan
      for (const log of logs) {
        assert.strictEqual(log.password, undefined);
        assert.strictEqual(log.token, undefined);
      }
    });
  });
});
