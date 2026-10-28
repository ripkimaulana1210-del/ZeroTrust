const express = require('express');
const { verifyToken } = require('../../gateway/src/tokens');
require('dotenv').config();

const LETTERS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D+', 'D', 'D-', 'E'];

function fail(res, status, error, message) {
  return res.status(status).json({ success: false, error, message });
}

function createNilaiApp(db, options = {}) {
  const app = express();
  const expectedGatewaySecret = options.gatewaySecret || process.env.GATEWAY_SECRET;
  const gatewayUrl = options.gatewayUrl || process.env.GATEWAY_URL || 'http://127.0.0.1:3000';
  const clientId = options.clientId || process.env.SERVICE_NILAI_CLIENT_ID;
  const clientSecret = options.clientSecret || process.env.SERVICE_NILAI_CLIENT_SECRET;
  const fetchImpl = options.fetch || global.fetch;
  if (!expectedGatewaySecret) throw new Error('GATEWAY_SECRET wajib dikonfigurasi untuk Service Nilai.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET wajib dikonfigurasi untuk Service Nilai.');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-Gateway-Secret');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));

  app.use((req, res, next) => {
    if (req.get('X-Gateway-Secret') !== expectedGatewaySecret) {
      return fail(res, 403, 'FORBIDDEN_DIRECT_ACCESS', 'Gateway secret tidak valid.');
    }
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) return fail(res, 401, 'UNAUTHORIZED', 'Bearer token wajib disertakan.');
    const verification = verifyToken(header.slice(7).trim());
    if (!verification.valid) return fail(res, 401, verification.error, verification.message);
    req.subject = verification.payload;
    next();
  });

  function requireUser(req, res) {
    const user = req.subject;
    if (user.type !== 'user' || !Number.isInteger(user.sub)) {
      fail(res, 403, 'FORBIDDEN', 'Operasi ini hanya untuk token pengguna.');
      return null;
    }
    const row = db.prepare('SELECT id, role, identifier FROM users WHERE id = ?').get(user.sub);
    if (!row || row.role !== user.role || (user.identifier && row.identifier !== user.identifier)) {
      fail(res, 403, 'FORBIDDEN', 'Identitas token tidak sesuai dengan data pengguna.');
      return null;
    }
    if (!tokenDeviceIsBound(user, req.get('X-Device-ID'))) {
      fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
      return null;
    }
    return row;
  }

  function tokenDeviceIsBound(subject, deviceId) {
    return Boolean(deviceId && db.prepare(`SELECT 1 FROM devices WHERE user_id = ? AND device_id = ? AND is_active = 1`).get(subject.sub, deviceId));
  }

  function currentJakartaHour() {
    if (typeof options.getCurrentHour === 'function') return Number(options.getCurrentHour());
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  }

  function resolveGrade(id) {
    return db.prepare(`SELECT n.id, n.kelas_id, n.mahasiswa_id, n.nilai_angka, COALESCE(n.nilai_huruf_v2, n.nilai_huruf) AS nilai_huruf,
      k.kode_mk, k.nama_mk, k.sks, k.dosen_id, k.status, m.identifier AS nim
      FROM nilai n JOIN kelas k ON k.id=n.kelas_id JOIN users m ON m.id=n.mahasiswa_id WHERE n.id=?`).get(id);
  }

  app.get('/nilai', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    if (user.role !== 'mahasiswa' && user.role !== 'dosen') return fail(res, 403, 'FORBIDDEN', 'Role tidak berhak melihat nilai.');
    if (user.role === 'mahasiswa' && !tokenDeviceIsBound(req.subject, req.get('X-Device-ID'))) return fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
    let rows;
    if (user.role === 'mahasiswa') {
      rows = db.prepare(`SELECT n.id, k.id AS kelas_id, k.kode_mk, k.nama_mk, k.sks, n.nilai_angka, COALESCE(n.nilai_huruf_v2,n.nilai_huruf) AS nilai_huruf, k.status FROM nilai n JOIN kelas k ON k.id=n.kelas_id WHERE n.mahasiswa_id=? ORDER BY k.kode_mk`).all(user.id);
    } else {
      rows = db.prepare(`SELECT n.id, k.id AS kelas_id, k.kode_mk, k.nama_mk, k.sks, k.status, n.mahasiswa_id, m.identifier AS nim, n.nilai_angka, COALESCE(n.nilai_huruf_v2,n.nilai_huruf) AS nilai_huruf FROM nilai n JOIN kelas k ON k.id=n.kelas_id JOIN users m ON m.id=n.mahasiswa_id WHERE k.dosen_id=? ORDER BY k.kode_mk, m.identifier`).all(user.id);
    }
    res.json({ success: true, data: rows });
  });

  app.get('/nilai/:id', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    const row = resolveGrade(req.params.id);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Nilai tidak ditemukan.');
    if (user.role === 'mahasiswa') {
      if (!tokenDeviceIsBound(req.subject, req.get('X-Device-ID'))) return fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
      if (row.mahasiswa_id !== user.id) return fail(res, 403, 'FORBIDDEN', 'Mahasiswa hanya dapat membaca nilainya sendiri.');
    } else if (user.role === 'dosen') {
      if (row.dosen_id !== user.id) return fail(res, 403, 'FORBIDDEN', 'Dosen hanya dapat membaca nilai kelas yang diampu.');
    } else return fail(res, 403, 'FORBIDDEN', 'Role tidak berhak melihat nilai.');
    res.json({ success: true, data: row });
  });

  app.get('/kelas', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    let rows;
    if (user.role === 'dosen') rows = db.prepare('SELECT id, kode_mk, nama_mk, sks, status, finalized_at FROM kelas WHERE dosen_id=? ORDER BY kode_mk').all(user.id);
    else if (user.role === 'mahasiswa') {
      if (!tokenDeviceIsBound(req.subject, req.get('X-Device-ID'))) return fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
      rows = db.prepare(`SELECT DISTINCT k.id, k.kode_mk, k.nama_mk, k.sks, k.status FROM kelas k JOIN nilai n ON n.kelas_id=k.id WHERE n.mahasiswa_id=? ORDER BY k.kode_mk`).all(user.id);
    } else return fail(res, 403, 'FORBIDDEN', 'Role tidak berhak melihat kelas.');
    res.json({ success: true, data: rows });
  });

  app.get('/kelas/:id', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    if (user.role === 'mahasiswa' && !tokenDeviceIsBound(req.subject, req.get('X-Device-ID'))) return fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
    let row;
    if (user.role === 'dosen') row = db.prepare('SELECT id, kode_mk, nama_mk, sks, status, finalized_at FROM kelas WHERE id=? AND dosen_id=?').get(req.params.id, user.id);
    else if (user.role === 'mahasiswa') row = db.prepare(`SELECT DISTINCT k.id, k.kode_mk, k.nama_mk, k.sks, k.status, k.finalized_at FROM kelas k JOIN nilai n ON n.kelas_id=k.id WHERE k.id=? AND n.mahasiswa_id=?`).get(req.params.id, user.id);
    else return fail(res, 403, 'FORBIDDEN', 'Role tidak berhak melihat kelas.');
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Kelas tidak ditemukan atau bukan dalam hak akses.');
    res.json({ success: true, data: row });
  });

  app.put('/nilai/:id', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    if (user.role !== 'dosen') return fail(res, 403, 'FORBIDDEN', 'Hanya dosen dapat mengubah nilai.');
    const grade = resolveGrade(req.params.id);
    if (!grade) return fail(res, 404, 'NOT_FOUND', 'Nilai tidak ditemukan.');
    if (grade.dosen_id !== user.id) return fail(res, 403, 'FORBIDDEN', 'Dosen hanya dapat mengubah kelas yang diampu.');
    if (grade.status === 'FINAL') return fail(res, 409, 'CLASS_FINAL', 'Nilai kelas final bersifat tetap.');
    const hour = currentJakartaHour();
    if (hour < 7 || hour >= 21) return fail(res, 403, 'OUTSIDE_ACCESS_HOURS', 'Perubahan nilai hanya pukul 07.00–21.00 WIB.');
    const { nilai_angka: score, nilai_huruf: letter } = req.body || {};
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100 || !LETTERS.includes(letter)) return fail(res, 400, 'INVALID_GRADE', 'Kirim nilai_angka 0–100 dan nilai_huruf pada skala A, A-, B+, B, B-, C+, C, D+, D, D-, E.');
    db.prepare('UPDATE nilai SET nilai_angka=?, nilai_huruf_v2=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(score, letter, grade.id);
    res.json({ success: true, data: resolveGrade(grade.id) });
  });

  app.post('/kelas/:id/finalisasi', async (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    if (user.role !== 'dosen') return fail(res, 403, 'FORBIDDEN', 'Hanya dosen dapat memfinalisasi kelas.');
    const klass = db.prepare('SELECT * FROM kelas WHERE id=?').get(req.params.id);
    if (!klass) return fail(res, 404, 'NOT_FOUND', 'Kelas tidak ditemukan.');
    if (klass.dosen_id !== user.id) return fail(res, 403, 'FORBIDDEN', 'Dosen hanya dapat memfinalisasi kelas yang diampu.');
    if (klass.status === 'FINAL' && !klass.sync_pending) return fail(res, 409, 'CLASS_FINAL', 'Kelas sudah final dan sinkron.');
    if (klass.status !== 'FINAL' && (currentJakartaHour() < 7 || currentJakartaHour() >= 21)) return fail(res, 403, 'OUTSIDE_ACCESS_HOURS', 'Finalisasi hanya pukul 07.00–21.00 WIB.');
    const grades = db.prepare(`SELECT n.id, n.mahasiswa_id, m.identifier AS nim, n.nilai_angka, COALESCE(n.nilai_huruf_v2, n.nilai_huruf) AS nilai_huruf FROM nilai n JOIN users m ON m.id=n.mahasiswa_id WHERE n.kelas_id=? ORDER BY n.mahasiswa_id`).all(klass.id);
    if (!grades.length || grades.some(g => !Number.isFinite(g.nilai_angka) || !LETTERS.includes(g.nilai_huruf))) return fail(res, 409, 'INVALID_SOURCE_GRADES', 'Kelas memiliki nilai kosong atau tidak valid; finalisasi dibatalkan.');
    if (!klass.sync_pending) {
      const markPending = db.transaction(() => {
        const changed = db.prepare("UPDATE kelas SET status='FINAL', sync_pending=1, finalized_at=CURRENT_TIMESTAMP WHERE id=? AND status='DRAFT' AND dosen_id=?").run(klass.id, user.id);
        if (changed.changes !== 1) throw new Error('CLASS_STATE_CHANGED_DURING_SYNC');
      });
      try { markPending(); }
      catch { return fail(res, 409, 'CLASS_STATE_CHANGED', 'Status kelas berubah selama finalisasi.'); }
    }
    if (!clientId || !clientSecret) return fail(res, 503, 'SERVICE_CREDENTIALS_MISSING', 'Credential Service Nilai belum dikonfigurasi; sinkronisasi tertunda dan dapat dicoba ulang.');
    try {
      const auth = await fetchImpl(`${gatewayUrl}/auth/service`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
      const authResult = await auth.json();
      if (!auth.ok || !authResult.serviceToken) return fail(res, 502, 'SERVICE_AUTH_FAILED', 'Gateway menolak autentikasi Service Nilai. Sinkronisasi dapat dicoba ulang.');
      const sync = await fetchImpl(`${gatewayUrl}/transkrip/sinkron`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${authResult.serviceToken}` }, body: JSON.stringify({ kelasId: klass.id }) });
      const syncResult = await sync.json();
      if (!sync.ok || !syncResult.success) return fail(res, 502, 'TRANSCRIPT_SYNC_FAILED', 'Sinkronisasi gagal; kelas berstatus FINAL dengan sync_pending=1 dan harus dicoba ulang.');
      db.prepare('UPDATE kelas SET sync_pending=0 WHERE id=? AND status=\'FINAL\' AND dosen_id=?').run(klass.id, user.id);
      // Source data is immutable after success; sink is idempotent, so a retry is safe if response is lost.
      res.json({ success: true, message: 'Nilai difinalisasi dan transkrip disinkronkan.', kelasId: klass.id, status: 'FINAL', synced: syncResult.count });
    } catch (error) {
      if (error.message === 'CLASS_CHANGED_DURING_SYNC') return fail(res, 409, 'CLASS_STATE_CHANGED', 'Status kelas berubah selama proses sinkronisasi.');
      fail(res, 502, 'TRANSCRIPT_SYNC_FAILED', 'Gateway atau Service Transkrip tidak tersedia; kelas berstatus FINAL dengan sync_pending=1 dan harus dicoba ulang.');
    }
  });

  app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Endpoint Service Nilai tidak ditemukan.'));
  app.use((err, req, res, next) => fail(res, 400, 'INVALID_REQUEST', 'Request JSON tidak valid atau gagal diproses.'));
  return app;
}

module.exports = { createNilaiApp, LETTERS };
