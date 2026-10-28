const express = require('express');
const { verifyToken } = require('../../gateway/src/tokens');
const { listFinalGradesForClass, upsertFinalGrades, calculateGpa, POINTS } = require('./repository');
require('dotenv').config();

function fail(res, status, error, message) { return res.status(status).json({ success: false, error, message }); }

function createTranskripApp(db, options = {}) {
  const app = express();
  const expectedGatewaySecret = options.gatewaySecret || process.env.GATEWAY_SECRET;
  if (!expectedGatewaySecret) throw new Error('GATEWAY_SECRET wajib dikonfigurasi untuk Service Transkrip.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET wajib dikonfigurasi untuk Service Transkrip.');
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-Gateway-Secret');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use((req, res, next) => {
    if (req.get('X-Gateway-Secret') !== expectedGatewaySecret) return fail(res, 403, 'FORBIDDEN_DIRECT_ACCESS', 'Gateway secret tidak valid.');
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) return fail(res, 401, 'UNAUTHORIZED', 'Bearer token wajib disertakan.');
    const verification = verifyToken(header.slice(7).trim());
    if (!verification.valid) return fail(res, 401, verification.error, verification.message);
    req.subject = verification.payload;
    next();
  });

  function getUser(req, res) {
    const sub = req.subject;
    if (sub.type !== 'user' || !Number.isInteger(sub.sub)) { fail(res, 403, 'FORBIDDEN', 'Token pengguna diperlukan.'); return null; }
    const user = db.prepare('SELECT id, role, identifier FROM users WHERE id=?').get(sub.sub);
    if (!user || user.role !== sub.role || (sub.identifier && user.identifier !== sub.identifier)) { fail(res, 403, 'FORBIDDEN', 'Identitas token tidak cocok dengan database.'); return null; }
    return user;
  }
  function deviceValid(req, user) {
    return Boolean(req.get('X-Device-ID') && db.prepare('SELECT 1 FROM devices WHERE user_id=? AND device_id=? AND is_active=1').get(user.id, req.get('X-Device-ID')));
  }

  app.post('/transkrip/sinkron', (req, res) => {
    const subject = req.subject;
    if (subject.type !== 'service' || subject.role !== 'service' || subject.sub !== (process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai')) return fail(res, 403, 'FORBIDDEN', 'Sinkronisasi hanya untuk Service Nilai terautentikasi.');
    const kelasId = Number(req.body?.kelasId);
    if (!Number.isInteger(kelasId) || kelasId <= 0) return fail(res, 400, 'INVALID_REQUEST', 'kelasId wajib berupa bilangan bulat positif.');
    const klass = db.prepare('SELECT id, kode_mk, status FROM kelas WHERE id=?').get(kelasId);
    if (!klass) return fail(res, 404, 'NOT_FOUND', 'Kelas tidak ditemukan.');
    if (klass.status !== 'FINAL') return fail(res, 409, 'CLASS_NOT_FINAL', 'Sinkronisasi hanya menerima kelas FINAL.');
    const rows = listFinalGradesForClass(db, kelasId);
    if (!rows.length || rows.some(row => row.status !== 'FINAL' || !Number.isInteger(row.sks) || row.sks <= 0 || !Object.hasOwn(POINTS, row.nilai_huruf))) return fail(res, 409, 'INVALID_SOURCE_DATA', 'Data nilai final tidak lengkap, SKS tidak valid, atau nilai huruf tidak dikenali.');
    const count = upsertFinalGrades(db, rows);
    res.json({ success: true, kelasId, count, message: 'Sinkronisasi idempoten berhasil.' });
  });

  app.get('/transkrip/:nim', (req, res) => {
    const user = getUser(req, res); if (!user) return;
    if (user.role === 'mahasiswa') {
      if (!deviceValid(req, user)) return fail(res, 403, 'DEVICE_NOT_REGISTERED', 'X-Device-ID tidak terikat ke pengguna.');
      if (user.identifier !== req.params.nim) return fail(res, 403, 'FORBIDDEN', 'Mahasiswa hanya dapat membaca transkrip miliknya.');
    } else if (user.role !== 'admin') return fail(res, 403, 'FORBIDDEN', 'Hanya mahasiswa dan admin dapat membaca transkrip.');
    const student = db.prepare('SELECT id, identifier, nama FROM users WHERE identifier=? AND role=\'mahasiswa\'').get(req.params.nim);
    if (!student) return fail(res, 404, 'NOT_FOUND', 'Mahasiswa tidak ditemukan.');
    const rows = db.prepare(`SELECT kode_mk, nama_mk, sks, nilai_huruf, updated_at FROM transkrip WHERE mahasiswa_id=?
      UNION ALL SELECT kode_mk, nama_mk, sks, nilai_huruf, updated_at FROM transkrip_v2 WHERE mahasiswa_id=? ORDER BY kode_mk`).all(student.id, student.id);
    let gpa;
    try { gpa = calculateGpa(db, student.id); }
    catch { return fail(res, 500, 'INVALID_TRANSCRIPT_DATA', 'Data transkrip tidak valid untuk menghitung IPK.'); }
    res.json({ success: true, mahasiswa: { nim: student.identifier, nama: student.nama }, data: rows, ringkasan: gpa });
  });

  app.use((req, res) => fail(res, 404, 'NOT_FOUND', 'Endpoint Service Transkrip tidak ditemukan.'));
  app.use((err, req, res, next) => fail(res, 400, 'INVALID_REQUEST', 'Request JSON tidak valid atau gagal diproses.'));
  return app;
}

module.exports = { createTranskripApp };
