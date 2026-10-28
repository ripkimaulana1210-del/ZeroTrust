/**
 * Definisi Skema Tabel dan Migrasi Idempoten untuk Zero Trust Security Database.
 */

const DDL_STATEMENTS = [
  // 1. Tabel users
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'dosen', 'mahasiswa')),
    identifier TEXT NOT NULL UNIQUE, -- NIM untuk mahasiswa, NIP untuk dosen, kode untuk admin
    nama TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,

  // 2. Tabel devices (terikat pada pengguna untuk verifikasi konteks X-Device-ID)
  `CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    label TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, device_id)
  );`,

  // 3. Tabel kelas (diampu oleh dosen)
  `CREATE TABLE IF NOT EXISTS kelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode_mk TEXT NOT NULL,
    nama_mk TEXT NOT NULL,
    sks INTEGER NOT NULL DEFAULT 3 CHECK(sks > 0),
    dosen_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'FINAL')),
    sync_pending INTEGER NOT NULL DEFAULT 0 CHECK(sync_pending IN (0, 1)),
    finalized_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dosen_id) REFERENCES users(id) ON DELETE RESTRICT
  );`,

  // 4. Tabel nilai (relasi kelas, mahasiswa, dan nilai tugas/ujian)
  `CREATE TABLE IF NOT EXISTS nilai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER NOT NULL,
    mahasiswa_id INTEGER NOT NULL,
    nilai_angka REAL CHECK(nilai_angka >= 0 AND nilai_angka <= 100),
    nilai_huruf TEXT CHECK(nilai_huruf IN ('A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D+', 'D', 'D-', 'E', 'AB', 'BC')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kelas_id) REFERENCES kelas(id) ON DELETE CASCADE,
    FOREIGN KEY (mahasiswa_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (kelas_id, mahasiswa_id)
  );`,

  // 5. Tabel transkrip (hasil kumulatif yang disinkronkan ke Service Transkrip)
  `CREATE TABLE IF NOT EXISTS transkrip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mahasiswa_id INTEGER NOT NULL,
    kode_mk TEXT NOT NULL,
    nama_mk TEXT NOT NULL,
    sks INTEGER NOT NULL DEFAULT 3 CHECK(sks > 0),
    nilai_huruf TEXT NOT NULL CHECK(nilai_huruf IN ('A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D+', 'D', 'D-', 'E', 'AB', 'BC')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mahasiswa_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (mahasiswa_id, kode_mk)
  );`,

  // 6. Tabel additive untuk transkrip nilai plus/minus yang tidak muat di CHECK legacy.
  `CREATE TABLE IF NOT EXISTS transkrip_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mahasiswa_id INTEGER NOT NULL,
    kode_mk TEXT NOT NULL,
    nama_mk TEXT NOT NULL,
    sks INTEGER NOT NULL CHECK(sks > 0),
    nilai_huruf TEXT NOT NULL CHECK(nilai_huruf IN ('A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D+', 'D', 'D-', 'E')),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mahasiswa_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (mahasiswa_id, kode_mk)
  );`,

  // 6. Tabel refresh_tokens (untuk pembatasan session dan pencabutan / revocation saat logout)
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    jti TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );`,

  // 7. Tabel audit_logs (telemetri keputusan evaluasi kebijakan ALLOW/DENY dari Policy Engine)
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    subject TEXT NOT NULL,
    role TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    device_id TEXT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('ALLOW', 'DENY')),
    reason TEXT NOT NULL
  );`
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
  `CREATE INDEX IF NOT EXISTS idx_devices_lookup ON devices(user_id, device_id);`,
  `CREATE INDEX IF NOT EXISTS idx_devices_devid ON devices(device_id);`,
  `CREATE INDEX IF NOT EXISTS idx_kelas_dosen ON kelas(dosen_id);`,
  `CREATE INDEX IF NOT EXISTS idx_nilai_kelas_mhs ON nilai(kelas_id, mahasiswa_id);`,
  `CREATE INDEX IF NOT EXISTS idx_nilai_mahasiswa ON nilai(mahasiswa_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transkrip_mhs ON transkrip(mahasiswa_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transkrip_v2_mhs ON transkrip_v2(mahasiswa_id);`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_lookup ON refresh_tokens(user_id, revoked);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_subject ON audit_logs(subject);`
];

/**
 * Menjalankan seluruh migrasi DDL dan indeks secara idempoten di dalam transaksi.
 * @param {import('better-sqlite3').Database} db
 */
function runMigrations(db) {
  const migrateTx = db.transaction(() => {
    for (const ddl of DDL_STATEMENTS) {
      db.exec(ddl);
    }
    // Forward-compatible additive migration: existing project DBs gain per-course credits.
    const classColumns = db.pragma('table_info(kelas)').map(column => column.name);
    if (!classColumns.includes('sks')) {
      db.exec('ALTER TABLE kelas ADD COLUMN sks INTEGER NOT NULL DEFAULT 3 CHECK(sks > 0);');
    }
    if (!classColumns.includes('sync_pending')) {
      db.exec('ALTER TABLE kelas ADD COLUMN sync_pending INTEGER NOT NULL DEFAULT 0 CHECK(sync_pending IN (0, 1));');
    }
    const gradeColumns = db.pragma('table_info(nilai)').map(column => column.name);
    if (!gradeColumns.includes('nilai_huruf_v2')) db.exec('ALTER TABLE nilai ADD COLUMN nilai_huruf_v2 TEXT;');
    const transcriptColumns = db.pragma('table_info(transkrip)').map(column => column.name);
    if (!transcriptColumns.includes('nilai_huruf_v2')) db.exec('ALTER TABLE transkrip ADD COLUMN nilai_huruf_v2 TEXT;');
    for (const idx of INDEX_STATEMENTS) {
      db.exec(idx);
    }
  });

  migrateTx();
}

/**
 * Menghapus seluruh tabel dan urutan auto-increment secara aman.
 * @param {import('better-sqlite3').Database} db
 */
function dropAllTables(db) {
  const tables = [
    'audit_logs',
    'refresh_tokens',
    'transkrip_v2',
    'transkrip',
    'nilai',
    'kelas',
    'devices',
    'users'
  ];

  const dropTx = db.transaction(() => {
    db.pragma('foreign_keys = OFF');
    for (const table of tables) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('${tables.join("', '")}');`);
    db.pragma('foreign_keys = ON');
  });

  dropTx();
}

module.exports = {
  DDL_STATEMENTS,
  INDEX_STATEMENTS,
  runMigrations,
  dropAllTables
};
