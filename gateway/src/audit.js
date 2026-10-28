/**
 * Modul Audit Logger — Menyimpan telemetri keputusan akses Policy Engine (NIST SP 800-207).
 * Seluruh keputusan (ALLOW / DENY) dicatat tanpa mengekspos data kredensial atau rahasia.
 */

/**
 * Mencatat hasil evaluasi kebijakan ke dalam tabel audit_logs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{
 *   timestamp?: string,
 *   subject?: string | number,
 *   role?: string,
 *   endpoint: string,
 *   method: string,
 *   deviceId?: string | null,
 *   decision: 'ALLOW' | 'DENY',
 *   reason: string
 * }} entry
 * @returns {number} lastInsertRowid
 */
function recordAudit(db, entry) {
  const timestamp = entry.timestamp || new Date().toISOString();
  const subject = String(entry.subject || 'anonymous');
  const role = String(entry.role || 'none');
  const endpoint = String(entry.endpoint || '-');
  const method = String(entry.method || '-').toUpperCase();
  const deviceId = entry.deviceId ? String(entry.deviceId) : null;
  const decision = entry.decision === 'ALLOW' ? 'ALLOW' : 'DENY';
  const reason = String(entry.reason || 'Tidak ada keterangan');

  const stmt = db.prepare(`
    INSERT INTO audit_logs (timestamp, subject, role, endpoint, method, device_id, decision, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const info = stmt.run(timestamp, subject, role, endpoint, method, deviceId, decision, reason);
  return info.lastInsertRowid;
}

/**
 * Mengambil rekaman audit log untuk keperluan inspeksi dan pengujian.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ limit?: number, offset?: number, decision?: 'ALLOW' | 'DENY', subject?: string }} [filters]
 * @returns {Array<object>}
 */
function getAuditLogs(db, filters = {}) {
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (filters.decision) {
    query += ' AND decision = ?';
    params.push(filters.decision);
  }

  if (filters.subject) {
    query += ' AND subject = ?';
    params.push(filters.subject);
  }

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?;';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

module.exports = {
  recordAudit,
  getAuditLogs
};
