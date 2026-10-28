const bcrypt = require('bcryptjs');

/**
 * Data awal akun pengguna (password akan di-hash sebelum disimpan).
 */
const SEED_USERS = [
  {
    username: 'admin',
    password_plain: 'admin123',
    role: 'admin',
    identifier: 'ADM001',
    nama: 'Administrator Akademik',
    devices: [
      { device_id: 'dev-admin-01', label: 'Laptop Admin Biro TI' }
    ]
  },
  {
    username: 'dosen_budi',
    password_plain: 'dosen123',
    role: 'dosen',
    identifier: '198501012010121001',
    nama: 'Budi Santoso, M.Kom.',
    devices: [
      { device_id: 'dev-dosen-budi', label: 'MacBook Pro Dosen' }
    ]
  },
  {
    username: 'dosen_siti',
    password_plain: 'dosen123',
    role: 'dosen',
    identifier: '198702022012122002',
    nama: 'Dr. Siti Aminah, M.T.',
    devices: [
      { device_id: 'dev-dosen-siti', label: 'ThinkPad Dosen' }
    ]
  },
  {
    username: 'mhs_ahmad',
    password_plain: 'mhs123',
    role: 'mahasiswa',
    identifier: '247006001',
    nama: 'Ahmad Fauzi',
    devices: [
      { device_id: 'dev-mhs-ahmad', label: 'Laptop Mahasiswa Ahmad' }
    ]
  },
  {
    username: 'mhs_rizki',
    password_plain: 'mhs123',
    role: 'mahasiswa',
    identifier: '247006002',
    nama: 'Rizki Pratama',
    devices: [
      { device_id: 'dev-mhs-rizki', label: 'Smartphone Mahasiswa Rizki' }
    ]
  },
  {
    username: 'mhs_dewi',
    password_plain: 'mhs123',
    role: 'mahasiswa',
    identifier: '247006003',
    nama: 'Dewi Lestari',
    devices: [
      { device_id: 'dev-mhs-dewi', label: 'Tablet Mahasiswa Dewi' }
    ]
  }
];

/**
 * Data awal kelas dan dosen pengampu.
 */
const SEED_CLASSES = [
  {
    kode_mk: 'IF2101',
    nama_mk: 'Keamanan Informasi',
    dosen_username: 'dosen_budi',
    status: 'DRAFT',
    sks: 3,
    grades: [
      { mhs_username: 'mhs_ahmad', nilai_angka: 85.0, nilai_huruf: 'A' },
      { mhs_username: 'mhs_rizki', nilai_angka: 78.0, nilai_huruf: 'B' },
      { mhs_username: 'mhs_dewi', nilai_angka: 82.0, nilai_huruf: 'AB' }
    ]
  },
  {
    kode_mk: 'IF2102',
    nama_mk: 'Jaringan Komputer Lanjut',
    dosen_username: 'dosen_siti',
    status: 'DRAFT',
    sks: 3,
    grades: [
      { mhs_username: 'mhs_ahmad', nilai_angka: 80.0, nilai_huruf: 'B+' },
      { mhs_username: 'mhs_rizki', nilai_angka: 88.0, nilai_huruf: 'A' },
      { mhs_username: 'mhs_dewi', nilai_angka: 72.0, nilai_huruf: 'C+' }
    ]
  }
];

/**
 * Data awal transkrip historis (mata kuliah semester sebelumnya).
 */
const SEED_TRANSCRIPTS = [
  { mhs_username: 'mhs_ahmad', kode_mk: 'IF1101', nama_mk: 'Dasar Pemrograman', sks: 3, nilai_huruf: 'A' },
  { mhs_username: 'mhs_rizki', kode_mk: 'IF1101', nama_mk: 'Dasar Pemrograman', sks: 3, nilai_huruf: 'AB' },
  { mhs_username: 'mhs_dewi', kode_mk: 'IF1101', nama_mk: 'Dasar Pemrograman', sks: 3, nilai_huruf: 'A' }
];

/**
 * Mengisi seed database secara idempoten.
 * @param {import('better-sqlite3').Database} db
 */
function seedDatabase(db) {
  const seedTx = db.transaction(() => {
    const salt = bcrypt.genSaltSync(10);

    // 1. Seed Users & Devices
    const insertUserStmt = db.prepare(`
      INSERT INTO users (username, password_hash, role, identifier, nama)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        role = excluded.role,
        identifier = excluded.identifier,
        nama = excluded.nama;
    `);

    const selectUserStmt = db.prepare(`SELECT id FROM users WHERE username = ?;`);

    const insertDeviceStmt = db.prepare(`
      INSERT INTO devices (user_id, device_id, label, is_active)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, device_id) DO UPDATE SET
        label = excluded.label,
        is_active = excluded.is_active;
    `);

    for (const u of SEED_USERS) {
      const hash = bcrypt.hashSync(u.password_plain, salt);
      insertUserStmt.run(u.username, hash, u.role, u.identifier, u.nama);
      const userRow = selectUserStmt.get(u.username);

      for (const dev of u.devices) {
        insertDeviceStmt.run(userRow.id, dev.device_id, dev.label);
      }
    }

    // 2. Seed Classes & Grades
    const selectDosenStmt = db.prepare(`SELECT id FROM users WHERE username = ?;`);
    const selectKelasStmt = db.prepare(`SELECT id FROM kelas WHERE kode_mk = ?;`);

    const insertKelasStmt = db.prepare(`
      INSERT INTO kelas (kode_mk, nama_mk, dosen_id, status, sks)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateKelasStmt = db.prepare(`
      UPDATE kelas SET nama_mk = ?, dosen_id = ?, status = ?, sks = ? WHERE kode_mk = ?;
    `);

    const insertNilaiStmt = db.prepare(`
      INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka, nilai_huruf)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(kelas_id, mahasiswa_id) DO UPDATE SET
        nilai_angka = excluded.nilai_angka,
        nilai_huruf = excluded.nilai_huruf,
        nilai_huruf_v2 = NULL,
        updated_at = CURRENT_TIMESTAMP;
    `);

    for (const c of SEED_CLASSES) {
      const dosen = selectDosenStmt.get(c.dosen_username);
      if (!dosen) {
        throw new Error(`Dosen ${c.dosen_username} tidak ditemukan.`);
      }

      let existingKelas = selectKelasStmt.get(c.kode_mk);
      let kelasId;
      if (existingKelas) {
        updateKelasStmt.run(c.nama_mk, dosen.id, c.status, c.sks || 3, c.kode_mk);
        kelasId = existingKelas.id;
      } else {
        const result = insertKelasStmt.run(c.kode_mk, c.nama_mk, dosen.id, c.status, c.sks || 3);
        kelasId = result.lastInsertRowid;
      }

      for (const g of c.grades) {
        const mhs = selectUserStmt.get(g.mhs_username);
        if (!mhs) {
          throw new Error(`Mahasiswa ${g.mhs_username} tidak ditemukan.`);
        }
        insertNilaiStmt.run(kelasId, mhs.id, g.nilai_angka, g.nilai_huruf);
      }
    }

    // 3. Seed Transcripts
    const insertLegacyTranskriptStmt = db.prepare(`
      INSERT INTO transkrip (mahasiswa_id, kode_mk, nama_mk, sks, nilai_huruf)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mahasiswa_id,kode_mk) DO UPDATE SET nama_mk=excluded.nama_mk,sks=excluded.sks,nilai_huruf=excluded.nilai_huruf,updated_at=CURRENT_TIMESTAMP;
    `);
    const insertExtendedTranscriptStmt = db.prepare(`
      INSERT INTO transkrip_v2 (mahasiswa_id, kode_mk, nama_mk, sks, nilai_huruf)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mahasiswa_id,kode_mk) DO UPDATE SET nama_mk=excluded.nama_mk,sks=excluded.sks,nilai_huruf=excluded.nilai_huruf,updated_at=CURRENT_TIMESTAMP;
    `);

    for (const t of SEED_TRANSCRIPTS) {
      const mhs = selectUserStmt.get(t.mhs_username);
      if (mhs) {
        if (['A','AB','B','BC','C','D','E'].includes(t.nilai_huruf)) insertLegacyTranskriptStmt.run(mhs.id, t.kode_mk, t.nama_mk, t.sks, t.nilai_huruf);
        else insertExtendedTranscriptStmt.run(mhs.id, t.kode_mk, t.nama_mk, t.sks, t.nilai_huruf);
      }
    }
  });

  seedTx();
}

module.exports = {
  SEED_USERS,
  SEED_CLASSES,
  SEED_TRANSCRIPTS,
  seedDatabase
};
