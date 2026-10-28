const POINTS = Object.freeze({ A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'D+': 1.7, D: 1.3, 'D-': 1, E: 0 });

function listFinalGradesForClass(db, kelasId) {
  return db.prepare(`SELECT n.mahasiswa_id, m.identifier AS nim, k.id AS kelas_id, k.kode_mk, k.nama_mk, k.sks, k.status, COALESCE(n.nilai_huruf_v2, n.nilai_huruf) AS nilai_huruf
    FROM kelas k JOIN nilai n ON n.kelas_id=k.id JOIN users m ON m.id=n.mahasiswa_id
    WHERE k.id=? ORDER BY n.mahasiswa_id`).all(kelasId);
}

function upsertFinalGrades(db, rows) {
  const apply = db.transaction(() => {
    const extended = db.prepare(`INSERT INTO transkrip_v2 (mahasiswa_id, kode_mk, nama_mk, sks, nilai_huruf)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(mahasiswa_id, kode_mk) DO UPDATE SET nama_mk=excluded.nama_mk, sks=excluded.sks, nilai_huruf=excluded.nilai_huruf, updated_at=CURRENT_TIMESTAMP`);
    for (const row of rows) extended.run(row.mahasiswa_id, row.kode_mk, row.nama_mk, row.sks, row.nilai_huruf);
  });
  apply();
  return rows.length;
}

function calculateGpa(db, mahasiswaId) {
  const rows = db.prepare(`SELECT sks, nilai_huruf FROM transkrip WHERE mahasiswa_id=? UNION ALL SELECT sks, nilai_huruf FROM transkrip_v2 WHERE mahasiswa_id=?`).all(mahasiswaId, mahasiswaId);
  let credits = 0;
  let points = 0;
  for (const row of rows) {
    const gradePoints = POINTS[row.nilai_huruf];
    if (!Number.isInteger(row.sks) || row.sks <= 0 || gradePoints === undefined) throw new Error('INVALID_TRANSCRIPT_ROW');
    credits += row.sks;
    points += row.sks * gradePoints;
  }
  return { ipk: credits ? Number((points / credits).toFixed(2)) : 0, totalSks: credits, mataKuliah: rows.length };
}

module.exports = { POINTS, listFinalGradesForClass, upsertFinalGrades, calculateGpa };
