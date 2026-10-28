const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

// Credentials exist only in this test process, never in source defaults or production logs.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-never-use-outside-tests';
process.env.GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'test-only-gateway-secret';
process.env.SERVICE_NILAI_CLIENT_SECRET = process.env.SERVICE_NILAI_CLIENT_SECRET || 'test-only-service-secret';
const TEST_GATEWAY_SECRET = process.env.GATEWAY_SECRET;
process.env.SERVICE_NILAI_CLIENT_ID = process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai';
require('dotenv').config();
const { getDatabase } = require('../database/connection');
const { runMigrations } = require('../database/schema');
const { seedDatabase } = require('../database/seed');
const { createApp } = require('../gateway/src/app');
const { generateAccessToken } = require('../gateway/src/tokens');

describe('Gateway HTTP & PEP Integration Tests', () => {
  let db;
  let gatewayApp;
  let gatewayServer;
  let gatewayUrl;

  // Mock downstream servers
  let mockNilaiServer;
  let mockNilaiUrl;
  let lastMockNilaiRequest = null;

  let mockTranskripServer;
  let mockTranskripUrl;
  let lastMockTranskripRequest = null;

  before(async () => {
    // 1. Jalankan Mock Service Nilai
    const mockNilaiApp = express();
    mockNilaiApp.use(express.json());
    mockNilaiApp.use((req, res) => {
      lastMockNilaiRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body
      };
      res.status(200).json({ success: true, from: 'mock-nilai', receivedBody: req.body });
    });

    await new Promise((resolve) => {
      mockNilaiServer = mockNilaiApp.listen(0, '127.0.0.1', () => {
        const port = mockNilaiServer.address().port;
        mockNilaiUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Jalankan Mock Service Transkrip
    const mockTranskripApp = express();
    mockTranskripApp.use(express.json());
    mockTranskripApp.use((req, res) => {
      lastMockTranskripRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body
      };
      res.status(200).json({ success: true, from: 'mock-transkrip', receivedBody: req.body });
    });

    await new Promise((resolve) => {
      mockTranskripServer = mockTranskripApp.listen(0, '127.0.0.1', () => {
        const port = mockTranskripServer.address().port;
        mockTranskripUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 3. Jalankan Gateway Server dengan target mock service
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db);

    gatewayApp = createApp(db, {
      serviceNilaiUrl: mockNilaiUrl,
      serviceTranskripUrl: mockTranskripUrl,
      // Internal deterministic test clock; the HTTP client cannot override it.
      getCurrentHour: () => 10
    });

    await new Promise((resolve) => {
      gatewayServer = gatewayApp.listen(0, '127.0.0.1', () => {
        const port = gatewayServer.address().port;
        gatewayUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (gatewayServer) gatewayServer.close();
    if (mockNilaiServer) mockNilaiServer.close();
    if (mockTranskripServer) mockTranskripServer.close();
    if (db) db.close();
  });

  beforeEach(() => {
    lastMockNilaiRequest = null;
    lastMockTranskripRequest = null;
  });

  /* -------------------------------------------------------------
   * 1. HEALTH CHECK ENDPOINT
   * ------------------------------------------------------------- */
  it('1. GET /health harus mengembalikan status UP tanpa membocorkan secret', async () => {
    const res = await fetch(`${gatewayUrl}/health`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.strictEqual(data.status, 'UP');
    assert.strictEqual(data.service, 'api-gateway');
    assert.strictEqual(data.role, 'PEP');
    assert.strictEqual(data.secret, undefined);
  });

  /* -------------------------------------------------------------
   * 2. HTTP AUTHENTICATION ENDPOINTS (/auth/*)
   * ------------------------------------------------------------- */
  describe('2. Endpoint HTTP Autentikasi Pengguna', () => {
    it('POST /auth/login harus sukses dengan kredensial benar dan device terdaftar', async () => {
      const res = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-mhs-ahmad'
        },
        body: JSON.stringify({
          username: 'mhs_ahmad',
          password: 'mhs123'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.accessToken);
      assert.ok(data.refreshToken);
      assert.strictEqual(data.user.username, 'mhs_ahmad');
      assert.strictEqual(data.user.identifier, '247006001');
    });

    it('POST /auth/login harus menolak password salah dengan status 401', async () => {
      const res = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-mhs-ahmad'
        },
        body: JSON.stringify({
          username: 'mhs_ahmad',
          password: 'password_salah'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error, 'INVALID_CREDENTIALS');
    });

    it('POST /auth/login harus menolak device asing dengan status 401', async () => {
      const res = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-device-asing'
        },
        body: JSON.stringify({
          username: 'mhs_ahmad',
          password: 'mhs123'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error, 'UNREGISTERED_DEVICE');
    });

    it('POST /auth/refresh harus merotasi refresh token dan menolak replay', async () => {
      // Login
      const loginRes = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-dosen-budi'
        },
        body: JSON.stringify({
          username: 'dosen_budi',
          password: 'dosen123'
        })
      });
      const loginData = await loginRes.json();
      const firstRefreshToken = loginData.refreshToken;

      // Refresh pertama
      const refreshRes = await fetch(`${gatewayUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-dosen-budi'
        },
        body: JSON.stringify({ refreshToken: firstRefreshToken })
      });

      assert.strictEqual(refreshRes.status, 200);
      const refreshData = await refreshRes.json();
      assert.ok(refreshData.accessToken);
      assert.ok(refreshData.refreshToken);
      assert.notStrictEqual(refreshData.refreshToken, firstRefreshToken);

      // Coba reuse firstRefreshToken -> Harus ditolak (Replay protection)
      const reuseRes = await fetch(`${gatewayUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: firstRefreshToken })
      });

      assert.strictEqual(reuseRes.status, 401);
      const reuseData = await reuseRes.json();
      assert.strictEqual(reuseData.error, 'TOKEN_REVOKED');
    });

    it('POST /auth/logout harus mencabut refresh token', async () => {
      const loginRes = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': 'dev-dosen-siti'
        },
        body: JSON.stringify({
          username: 'dosen_siti',
          password: 'dosen123'
        })
      });
      const loginData = await loginRes.json();

      // Logout
      const logoutRes = await fetch(`${gatewayUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: loginData.refreshToken })
      });
      assert.strictEqual(logoutRes.status, 200);

      // Coba refresh setelah logout -> Ditolak
      const refreshRes = await fetch(`${gatewayUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: loginData.refreshToken })
      });
      assert.strictEqual(refreshRes.status, 401);
    });

    it('POST /auth/service harus menerbitkan Service Token 5 menit', async () => {
      const res = await fetch(`${gatewayUrl}/auth/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'service-nilai',
          clientSecret: process.env.SERVICE_NILAI_CLIENT_SECRET || 'dev-service-nilai-client-secret-key'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.serviceToken);
    });
  });

  /* -------------------------------------------------------------
   * 3. PENEGAKAN KEBIJAKAN PEP & REVERSE PROXY
   * ------------------------------------------------------------- */
  describe('3. Penegakan PEP pada Rute Terproteksi', () => {
    let mhsToken;
    let dosenBudiToken;
    let adminToken;
    let serviceToken;

    before(async () => {
      // Dapatkan token untuk masing-masing role
      const mhsLogin = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'dev-mhs-ahmad' },
        body: JSON.stringify({ username: 'mhs_ahmad', password: 'mhs123' })
      });
      mhsToken = (await mhsLogin.json()).accessToken;

      const dosenLogin = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'dev-dosen-budi' },
        body: JSON.stringify({ username: 'dosen_budi', password: 'dosen123' })
      });
      dosenBudiToken = (await dosenLogin.json()).accessToken;

      const adminLogin = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'dev-admin-01' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      adminToken = (await adminLogin.json()).accessToken;

      const s2sRes = await fetch(`${gatewayUrl}/auth/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'service-nilai',
          clientSecret: process.env.SERVICE_NILAI_CLIENT_SECRET || 'dev-service-nilai-client-secret-key'
        })
      });
      serviceToken = (await s2sRes.json()).serviceToken;
    });

    it('Harus menolak request tanpa header Authorization (401)', async () => {
      const res = await fetch(`${gatewayUrl}/nilai`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'UNAUTHORIZED');
      assert.strictEqual(lastMockNilaiRequest, null, 'Request tidak boleh mencapai resource downstream');
    });

    it('Harus menolak request dengan token palsu / signature salah (401)', async () => {
      const res = await fetch(`${gatewayUrl}/nilai`, {
        headers: {
          'Authorization': 'Bearer token-palsu-ngawur',
          'X-Device-ID': 'dev-mhs-ahmad'
        }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(lastMockNilaiRequest, null);
    });

    it('Harus menolak request dengan token expired (401)', async () => {
      const expiredToken = generateAccessToken(
        { id: 4, username: 'mhs_ahmad', role: 'mahasiswa', identifier: '247006001' },
        '0s'
      );
      const res = await fetch(`${gatewayUrl}/nilai`, {
        headers: {
          'Authorization': `Bearer ${expiredToken}`,
          'X-Device-ID': 'dev-mhs-ahmad'
        }
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'TOKEN_EXPIRED');
      assert.strictEqual(lastMockNilaiRequest, null);
    });

    it('Harus menolak request jika X-Device-ID tidak disertakan (403)', async () => {
      const res = await fetch(`${gatewayUrl}/nilai`, {
        headers: {
          'Authorization': `Bearer ${mhsToken}`
          // X-Device-ID sengaja tidak disertakan
        }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /X-Device-ID/);
      assert.strictEqual(lastMockNilaiRequest, null);
    });

    it('Harus menolak request jika X-Device-ID asing / tidak terdaftar di DB (403)', async () => {
      const res = await fetch(`${gatewayUrl}/nilai`, {
        headers: {
          'Authorization': `Bearer ${mhsToken}`,
          'X-Device-ID': 'dev-perangkat-ilegal'
        }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /Perangkat tidak terdaftar/);
      assert.strictEqual(lastMockNilaiRequest, null);
    });

    it('Harus menolak IDOR: Mahasiswa Ahmad mencoba melihat transkrip Mahasiswa Rizki (403)', async () => {
      const res = await fetch(`${gatewayUrl}/transkrip/247006002`, {
        headers: {
          'Authorization': `Bearer ${mhsToken}`,
          'X-Device-ID': 'dev-mhs-ahmad'
        }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /NIM miliknya sendiri/);
      assert.strictEqual(lastMockTranskripRequest, null);
    });

    it('Harus menolak token user pada endpoint POST /transkrip/sinkron (403)', async () => {
      const res = await fetch(`${gatewayUrl}/transkrip/sinkron`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'X-Device-ID': 'dev-admin-01'
        }
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.match(data.message, /Token user ditolak/);
      assert.strictEqual(lastMockTranskripRequest, null);
    });
  });

  /* -------------------------------------------------------------
   * 4. PENGUJIAN PROXY FORWARDING, INJECTION SECRET & RE-STREAM BODY
   * ------------------------------------------------------------- */
  describe('4. Verifikasi Injeksi X-Gateway-Secret & Restream Body', () => {
    let dosenToken;
    let serviceToken;

    before(async () => {
      const dosenLogin = await fetch(`${gatewayUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'dev-dosen-budi' },
        body: JSON.stringify({ username: 'dosen_budi', password: 'dosen123' })
      });
      dosenToken = (await dosenLogin.json()).accessToken;

      const s2sRes = await fetch(`${gatewayUrl}/auth/service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'service-nilai',
          clientSecret: process.env.SERVICE_NILAI_CLIENT_SECRET || 'dev-service-nilai-client-secret-key'
        })
      });
      serviceToken = (await s2sRes.json()).serviceToken;
    });

    it('Harus menyuntikkan X-Gateway-Secret dan meneruskan JSON body utuh ke downstream', async () => {
      const updatePayload = { nilai_angka: 92.5, nilai_huruf: 'A' };

      const res = await fetch(`${gatewayUrl}/nilai/1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${dosenToken}`,
          'X-Device-ID': 'dev-dosen-budi',
          // Client mencoba menyuntikkan gateway secret palsu
          'X-Gateway-Secret': 'palsu-dari-luar'
        },
        body: JSON.stringify(updatePayload)
      });

      assert.strictEqual(res.status, 200);
      assert.ok(lastMockNilaiRequest, 'Mock service downstream harus menerima request');

      // 1. Verifikasi header X-Gateway-Secret disuntikkan oleh Gateway, bukan dari klien luar
      const expectedSecret = process.env.GATEWAY_SECRET || 'dev-gateway-secret-key-3000-internal';
      assert.strictEqual(lastMockNilaiRequest.headers['x-gateway-secret'], expectedSecret);
      assert.notStrictEqual(lastMockNilaiRequest.headers['x-gateway-secret'], 'palsu-dari-luar');

      // 2. Verifikasi Bearer token diteruskan
      assert.strictEqual(lastMockNilaiRequest.headers['authorization'], `Bearer ${dosenToken}`);

      // 3. Verifikasi URL dan path utuh (tidak terpotong oleh proxy mount)
      assert.strictEqual(lastMockNilaiRequest.url, '/nilai/1');

      // 4. Verifikasi Body JSON diterima utuh tanpa hilang akibat body parser
      assert.deepStrictEqual(lastMockNilaiRequest.body, updatePayload);
    });

    it('Harus mengizinkan Service Token pada POST /transkrip/sinkron dan menyuntikkan secret', async () => {
      const syncPayload = { kelas_id: 1, action: 'SYNC' };

      const res = await fetch(`${gatewayUrl}/transkrip/sinkron`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceToken}`
        },
        body: JSON.stringify(syncPayload)
      });

      assert.strictEqual(res.status, 200);
      assert.ok(lastMockTranskripRequest, 'Mock Transkrip downstream harus menerima request');
      assert.strictEqual(lastMockTranskripRequest.url, '/transkrip/sinkron');
      assert.strictEqual(
        lastMockTranskripRequest.headers['x-gateway-secret'],
        process.env.GATEWAY_SECRET || 'dev-gateway-secret-key-3000-internal'
      );
      assert.deepStrictEqual(lastMockTranskripRequest.body, syncPayload);
    });
  });

  /* -------------------------------------------------------------
   * 5. VERIFIKASI AUDIT LOG
   * ------------------------------------------------------------- */
  it('5. Audit Log harus mencatat seluruh event ALLOW dan DENY dari request HTTP', () => {
    const logs = db.prepare('SELECT decision, count(*) as c FROM audit_logs GROUP BY decision;').all();
    const allowCount = logs.find(l => l.decision === 'ALLOW')?.c || 0;
    const denyCount = logs.find(l => l.decision === 'DENY')?.c || 0;

    assert.ok(allowCount > 0, 'Harus ada rekaman audit berstatus ALLOW');
    assert.ok(denyCount > 0, 'Harus ada rekaman audit berstatus DENY');

    // Pastikan tidak ada data sensitif tersimpan
    const sampleLog = db.prepare('SELECT * FROM audit_logs LIMIT 1;').get();
    assert.strictEqual(sampleLog.password, undefined);
    assert.strictEqual(sampleLog.secret, undefined);
  });
});
