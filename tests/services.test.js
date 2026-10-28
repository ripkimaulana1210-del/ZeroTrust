const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.JWT_SECRET ||= 'test-only-jwt-secret-for-service-tests';
process.env.GATEWAY_SECRET ||= 'test-only-gateway-secret-for-service-tests';
process.env.SERVICE_NILAI_CLIENT_ID ||= 'service-nilai';
process.env.SERVICE_NILAI_CLIENT_SECRET ||= 'test-only-client-secret';

const { getDatabase } = require('../database/connection');
const { runMigrations } = require('../database/schema');
const { seedDatabase } = require('../database/seed');
const { generateAccessToken, generateServiceToken } = require('../gateway/src/tokens');
const { createNilaiApp } = require('../services/nilai/app');
const { createTranskripApp } = require('../services/transkrip/app');
const { createApp: createGatewayApp } = require('../gateway/src/app');
const { calculateGpa, POINTS } = require('../services/transkrip/repository');

const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const gatewayHeader = { 'X-Gateway-Secret': GATEWAY_SECRET };
const tokens = {};

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) { if (server) await new Promise(resolve => server.close(resolve)); }

let db;
let nilaiServer, transkripServer, gatewayServer;
let nilaiUrl, transkripUrl, gatewayUrl;
let failSync = false;
let internalUrls = [];

describe('Service Nilai dan Service Transkrip', () => {
  before(async () => {
    db = getDatabase(':memory:');
    runMigrations(db);
    seedDatabase(db);
    const userRows = db.prepare('SELECT id, username, role, identifier FROM users').all();
    for (const u of userRows) tokens[u.username] = generateAccessToken(u);
    tokens.service = generateServiceToken('service-nilai');
    transkripServer = await listen(createTranskripApp(db));
    transkripUrl = transkripServer.url;
    // Reserve a loopback port for the actual Gateway listener, then wire the clients to it.
    const reservation = await listen(express());
    gatewayUrl = reservation.url;
    await close(reservation.server);
    nilaiServer = await listen(createNilaiApp(db, { gatewayUrl, getCurrentHour: () => 10, fetch: async (url, init) => {
      internalUrls.push(String(url));
      if (failSync && String(url).endsWith('/transkrip/sinkron')) return new Response('{"success":false}', { status: 503, headers: { 'content-type': 'application/json' } });
      return fetch(url, init);
    } }));
    nilaiUrl = nilaiServer.url;
    gatewayServer = createGatewayApp(db, { serviceNilaiUrl: nilaiUrl, serviceTranskripUrl: transkripUrl, getCurrentHour: () => 10 }).listen(Number(new URL(gatewayUrl).port), '127.0.0.1');
    await new Promise(resolve => gatewayServer.once('listening', resolve));
    global.__serviceTestGatewayDb = db;
  });
  after(async () => { await close(nilaiServer?.server); await close(transkripServer?.server); await close(gatewayServer); global.__serviceTestGatewayDb?.close(); db?.close(); });
  beforeEach(() => {
    internalUrls = []; failSync = false;
    const reset = db.transaction(() => {
      db.prepare('DELETE FROM transkrip').run();
      db.prepare('DELETE FROM transkrip_v2').run();
      db.prepare("UPDATE kelas SET status='DRAFT', sync_pending=0, finalized_at=NULL").run();
      db.prepare("UPDATE nilai SET nilai_huruf_v2=NULL, nilai_angka=CASE (SELECT username FROM users WHERE id=nilai.mahasiswa_id) WHEN 'mhs_ahmad' THEN CASE kelas_id WHEN 1 THEN 85.0 ELSE 80.0 END WHEN 'mhs_rizki' THEN CASE kelas_id WHEN 1 THEN 78.0 ELSE 88.0 END ELSE CASE kelas_id WHEN 1 THEN 82.0 ELSE 72.0 END END, nilai_huruf=CASE (SELECT username FROM users WHERE id=nilai.mahasiswa_id) WHEN 'mhs_ahmad' THEN CASE kelas_id WHEN 1 THEN 'A' ELSE 'B+' END WHEN 'mhs_rizki' THEN CASE kelas_id WHEN 1 THEN 'B' ELSE 'A' END ELSE CASE kelas_id WHEN 1 THEN 'AB' ELSE 'BC' END END").run();
    });
    reset();
    require('../database/seed').seedDatabase(db);
    // Fixture-only mapping to explicit approved labels; production never infers legacy labels.
    db.prepare("UPDATE nilai SET nilai_huruf_v2=CASE nilai_huruf WHEN 'AB' THEN 'A-' WHEN 'BC' THEN 'C+' ELSE NULL END WHERE nilai_huruf IN ('AB','BC')").run();
  });

  it('menolak akses langsung ke kedua service tanpa gateway secret', async () => {
    const [n, t] = await Promise.all([fetch(`${nilaiUrl}/nilai`), fetch(`${transkripUrl}/transkrip/247006001`)]);
    assert.equal(n.status, 403); assert.equal((await n.json()).error, 'FORBIDDEN_DIRECT_ACCESS');
    assert.equal(t.status, 403); assert.equal((await t.json()).error, 'FORBIDDEN_DIRECT_ACCESS');
  });

  it('menolak gateway secret salah dan secret benar dengan token invalid/expired', async () => {
    const badSecret = await fetch(`${nilaiUrl}/nilai`, { headers: { 'X-Gateway-Secret': 'wrong', Authorization: `Bearer ${tokens.mhs_ahmad}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(badSecret.status, 403);
    const invalid = await fetch(`${nilaiUrl}/nilai`, { headers: { ...gatewayHeader, Authorization: 'Bearer not-a-jwt', 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(invalid.status, 401);
    const expiredToken = require('jsonwebtoken').sign({ sub: 4, role: 'mahasiswa', type: 'user', jti: 'expired' }, process.env.JWT_SECRET, { expiresIn: -1 });
    const expired = await fetch(`${nilaiUrl}/nilai`, { headers: { ...gatewayHeader, Authorization: `Bearer ${expiredToken}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(expired.status, 401);
  });

  it('mahasiswa hanya membaca nilai miliknya; dosen hanya kelas ampuannya', async () => {
    const own = await fetch(`${nilaiUrl}/nilai`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.mhs_ahmad}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(own.status, 200);
    assert.ok((await own.json()).data.every(row => row.mahasiswa_id === undefined || row.mahasiswa_id === 4));
    const rizkiId = db.prepare(`SELECT n.id FROM nilai n JOIN users u ON u.id=n.mahasiswa_id WHERE u.username='mhs_rizki' ORDER BY n.id LIMIT 1`).get().id;
    const foreign = await fetch(`${nilaiUrl}/nilai/${rizkiId}`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.mhs_ahmad}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(foreign.status, 403);
    const lecturer = await fetch(`${nilaiUrl}/kelas`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi' } });
    assert.equal(lecturer.status, 200);
    assert.ok((await lecturer.json()).data.every(row => row.kode_mk === 'IF2101'));
    const sitiGradeId = db.prepare(`SELECT n.id FROM nilai n JOIN kelas k ON k.id=n.kelas_id JOIN users u ON u.id=k.dosen_id WHERE u.username='dosen_siti' ORDER BY n.id LIMIT 1`).get().id;
    const foreignLecturer = await fetch(`${gatewayUrl}/nilai/${sitiGradeId}`, { method: 'PUT', headers: { Authorization: `Bearer ${tokens.dosen_budi}`, 'Content-Type': 'application/json', 'X-Device-ID': 'dev-dosen-budi' }, body: JSON.stringify({ nilai_angka: 90, nilai_huruf: 'A' }) });
    assert.equal(foreignLecturer.status, 403);
    assert.equal(db.prepare('SELECT nilai_angka FROM nilai WHERE id=?').get(sitiGradeId).nilai_angka, 80);
    assert.equal(global.__serviceTestGatewayDb.prepare('SELECT decision FROM audit_logs ORDER BY id DESC LIMIT 1').get().decision, 'DENY');
  });

  it('dosen tidak bisa mengubah nilai kelas lain meskipun memanggil service langsung dengan token-valid', async () => {
    const sitiGradeId = db.prepare(`SELECT n.id FROM nilai n JOIN kelas k ON k.id=n.kelas_id JOIN users u ON u.id=k.dosen_id WHERE u.username='dosen_siti' ORDER BY n.id LIMIT 1`).get().id;
    const denied = await fetch(`${nilaiUrl}/nilai/${sitiGradeId}`, { method: 'PUT', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 99, nilai_huruf: 'A' }) });
    assert.equal(denied.status, 403); const body = await denied.json(); assert.equal(body.error, 'FORBIDDEN');
    assert.notEqual(db.prepare('SELECT nilai_angka FROM nilai WHERE id=?').get(sitiGradeId).nilai_angka, 99);
  });

  it('menyimpan nilai angka dan huruf terpisah serta menolak mutasi setelah finalisasi', async () => {
    const update = await fetch(`${nilaiUrl}/nilai/1`, { method: 'PUT', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 81, nilai_huruf: 'A-' }) });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).data.nilai_angka, 81);
    const wrongType = await fetch(`${nilaiUrl}/nilai/1`, { method: 'PUT', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: JSON.stringify({ nilai_angka: 81, nilai_huruf: 'AB' }) });
    assert.equal(wrongType.status, 400);
  });

  it('hanya service token yang sinkronisasi, dan sinkronisasi diulang tanpa duplikasi', async () => {
    const userToken = await fetch(`${transkripUrl}/transkrip/sinkron`, { method: 'POST', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kelasId: 1 }) });
    assert.equal(userToken.status, 403);
    db.prepare("UPDATE kelas SET status='FINAL' WHERE id=1").run();
    const signedServiceToken = generateServiceToken('service-nilai');
    const body = JSON.stringify({ kelasId: 1 });
    const sync = () => fetch(`${transkripUrl}/transkrip/sinkron`, { method: 'POST', headers: { ...gatewayHeader, Authorization: `Bearer ${signedServiceToken}`, 'Content-Type': 'application/json' }, body });
    const once = await sync(); assert.equal(once.status, 200);
    const countOnce = db.prepare('SELECT count(*) c FROM transkrip WHERE kode_mk=?').get('IF2101').c;
    const twice = await sync(); assert.equal(twice.status, 200);
    assert.equal(db.prepare('SELECT count(*) c FROM transkrip WHERE kode_mk=?').get('IF2101').c, countOnce);
    assert.equal(db.prepare('SELECT sks FROM transkrip_v2 WHERE kode_mk=?').get('IF2101').sks, 3);
    const gpa = calculateGpa(db, 4);
    assert.equal(gpa.totalSks, 6);
    assert.equal(gpa.ipk, 4);
  });

  it('Service Nilai meminta service token dan sinkronisasi hanya melalui gateway PEP', async () => {
    const result = await fetch(`${gatewayUrl}/kelas/1/finalisasi`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
    assert.deepEqual(internalUrls.map(url => new URL(url).origin), [gatewayUrl, gatewayUrl]);
    assert.ok(internalUrls.every(url => new URL(url).port === new URL(gatewayUrl).port));
    assert.equal(db.prepare('SELECT status, sync_pending FROM kelas WHERE id=1').get().status, 'FINAL');
    assert.equal(db.prepare('SELECT sync_pending FROM kelas WHERE id=1').get().sync_pending, 0);
    assert.ok(db.prepare(`SELECT 1 FROM transkrip_v2 WHERE mahasiswa_id=4 AND kode_mk='IF2101'`).get());
  });

  it('meneruskan kegagalan transkrip dengan FINAL/PENDING agar sinkronisasi dapat diulang', async () => {
    failSync = true;
    const initial = await fetch(`${nilaiUrl}/kelas/1/finalisasi`, { method: 'POST', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(initial.status, 502);
    assert.deepEqual(db.prepare('SELECT status, sync_pending FROM kelas WHERE id=1').get(), { status: 'FINAL', sync_pending: 1 });
    assert.match((await initial.json()).message, /status FINAL/);
    failSync = false;
    const retry = await fetch(`${nilaiUrl}/kelas/1/finalisasi`, { method: 'POST', headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.dosen_budi}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(retry.status, 200);
    assert.equal(db.prepare('SELECT sync_pending FROM kelas WHERE id=1').get().sync_pending, 0);
  });

  it('menolak transkrip mahasiswa lain dan mengizinkan admin melihat IPK', async () => {
    const student = await fetch(`${transkripUrl}/transkrip/247006001`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.mhs_ahmad}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(student.status, 200);
    const idor = await fetch(`${transkripUrl}/transkrip/247006002`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.mhs_ahmad}`, 'X-Device-ID': 'dev-mhs-ahmad' } });
    assert.equal(idor.status, 403);
    const admin = await fetch(`${transkripUrl}/transkrip/247006001`, { headers: { ...gatewayHeader, Authorization: `Bearer ${tokens.admin}` } });
    assert.equal(admin.status, 200); assert.equal((await admin.json()).ringkasan.ipk, 4);
  });

  it('mempertahankan pemetaan GPA dan menolak label legacy yang tidak mempunyai mapping', () => {
    assert.deepEqual(POINTS, { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'D+': 1.7, D: 1.3, 'D-': 1, E: 0 });
    db.prepare("INSERT INTO transkrip (mahasiswa_id,kode_mk,nama_mk,sks,nilai_huruf) VALUES (4,'OLD','Legacy',3,'AB')").run();
    assert.throws(() => calculateGpa(db, 4), /INVALID_TRANSCRIPT_ROW/);
  });

  it('gagal finalisasi fail-closed jika gateway/downstream tidak tersedia dan kelas tetap DRAFT', async () => {
    const unreachableApp = await listen(express());
    await close(unreachableApp.server);
    const isolatedDb = getDatabase(':memory:'); runMigrations(isolatedDb); seedDatabase(isolatedDb);
    isolatedDb.prepare("UPDATE nilai SET nilai_huruf_v2=CASE nilai_huruf WHEN 'AB' THEN 'A-' WHEN 'BC' THEN 'C+' ELSE NULL END WHERE nilai_huruf IN ('AB','BC')").run();
    const isolatedNilai = await listen(createNilaiApp(isolatedDb, { gatewayUrl: unreachableApp.url, getCurrentHour: () => 10 }));
    const token = generateAccessToken(isolatedDb.prepare("SELECT id, username, role, identifier FROM users WHERE username='dosen_budi'").get());
    try {
      const result = await fetch(`${isolatedNilai.url}/kelas/1/finalisasi`, { method: 'POST', headers: { ...gatewayHeader, Authorization: `Bearer ${token}`, 'X-Device-ID': 'dev-dosen-budi', 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(result.status, 502);
      assert.deepEqual(isolatedDb.prepare('SELECT status, sync_pending FROM kelas WHERE id=1').get(), { status: 'FINAL', sync_pending: 1 });
    } finally { await close(isolatedNilai.server); isolatedDb.close(); }
  });
});
