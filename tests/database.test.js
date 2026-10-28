const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../database/connection');
const { runMigrations, dropAllTables } = require('../database/schema');
const { seedDatabase } = require('../database/seed');

describe('Database SQLite & Seed Tests (Zero Trust Security)', () => {
  let db;

  beforeEach(() => {
    // Gunakan in-memory database untuk isolasi total pengujian
    db = getDatabase(':memory:');
    runMigrations(db);
  });

  it('1. Memastikan semua tabel wajib berhasil dibuat oleh migrasi', () => {
    const requiredTables = [
      'users',
      'devices',
      'kelas',
      'nilai',
      'transkrip',
      'refresh_tokens',
      'audit_logs'
    ];

    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';
    `).all().map(r => r.name);

    for (const table of requiredTables) {
      assert.ok(existingTables.includes(table), `Tabel '${table}' harus ada di database.`);
    }
  });

  it('2. Memastikan penegakan Foreign Key aktif (PRAGMA foreign_keys = ON)', () => {
    const fkPragma = db.pragma('foreign_keys', { simple: true });
    assert.strictEqual(fkPragma, 1, 'Foreign keys pragma harus bernilai 1 (aktif).');

    // Coba insert device dengan user_id yang tidak ada di tabel users
    assert.throws(() => {
      db.prepare(`
        INSERT INTO devices (user_id, device_id, label)
        VALUES (9999, 'dev-invalid', 'Perangkat Ilegal');
      `).run();
    }, /FOREIGN KEY constraint failed/, 'Harus menolak insert dengan user_id non-existent.');
  });

  it('3. Memastikan CHECK constraints role pada tabel users bekerja', () => {
    // Valid role: admin, dosen, mahasiswa
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO users (username, password_hash, role, identifier, nama)
        VALUES ('test_admin', 'hash123', 'admin', 'ADM_TEST', 'Test Admin');
      `).run();
    });

    // Invalid role: hacker
    assert.throws(() => {
      db.prepare(`
        INSERT INTO users (username, password_hash, role, identifier, nama)
        VALUES ('test_hacker', 'hash123', 'hacker', 'HCK_TEST', 'Test Hacker');
      `).run();
    }, /CHECK constraint failed/, 'Harus menolak user dengan role ilegal.');
  });

  it('4. Memastikan CHECK constraints status pada tabel kelas bekerja', () => {
    const userRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, identifier, nama)
      VALUES ('dosen_test', 'hash', 'dosen', '123456', 'Dosen Test');
    `).run();

    // Valid status: DRAFT
    assert.doesNotThrow(() => {
      db.prepare(`
        INSERT INTO kelas (kode_mk, nama_mk, dosen_id, status)
        VALUES ('MK01', 'Mata Kuliah 1', ?, 'DRAFT');
      `).run(userRes.lastInsertRowid);
    });

    // Invalid status: PUBLISHED
    assert.throws(() => {
      db.prepare(`
        INSERT INTO kelas (kode_mk, nama_mk, dosen_id, status)
        VALUES ('MK02', 'Mata Kuliah 2', ?, 'PUBLISHED');
      `).run(userRes.lastInsertRowid);
    }, /CHECK constraint failed/, 'Harus menolak kelas dengan status selain DRAFT atau FINAL.');
  });

  it('5. Memastikan CHECK constraints nilai_angka dan nilai_huruf pada tabel nilai bekerja', () => {
    const dosenRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, identifier, nama)
      VALUES ('dosen_t', 'hash', 'dosen', 'NIP01', 'Dosen T');
    `).run();

    const mhsRes = db.prepare(`
      INSERT INTO users (username, password_hash, role, identifier, nama)
      VALUES ('mhs_t', 'hash', 'mahasiswa', 'NIM01', 'Mhs T');
    `).run();

    const kelasRes = db.prepare(`
      INSERT INTO kelas (kode_mk, nama_mk, dosen_id, status)
      VALUES ('MK10', 'MK Test', ?, 'DRAFT');
    `).run(dosenRes.lastInsertRowid);

    // Invalid nilai_angka: > 100
    assert.throws(() => {
      db.prepare(`
        INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka, nilai_huruf)
        VALUES (?, ?, 105.0, 'A');
      `).run(kelasRes.lastInsertRowid, mhsRes.lastInsertRowid);
    }, /CHECK constraint failed/, 'Nilai angka di atas 100 harus ditolak.');

    // Invalid nilai_huruf: 'Z'
    assert.throws(() => {
      db.prepare(`
        INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka, nilai_huruf)
        VALUES (?, ?, 80.0, 'Z');
      `).run(kelasRes.lastInsertRowid, mhsRes.lastInsertRowid);
    }, /CHECK constraint failed/, 'Nilai huruf di luar opsi standar harus ditolak.');
  });

  it('6. Memastikan UNIQUE constraints pada username dan relasi device bekerja', () => {
    db.prepare(`
      INSERT INTO users (username, password_hash, role, identifier, nama)
      VALUES ('user_unique', 'hash', 'mahasiswa', 'ID01', 'Unique User');
    `).run();

    // Duplicate username
    assert.throws(() => {
      db.prepare(`
        INSERT INTO users (username, password_hash, role, identifier, nama)
        VALUES ('user_unique', 'hash2', 'mahasiswa', 'ID02', 'Duplicate User');
      `).run();
    }, /UNIQUE constraint failed/, 'Username duplikat harus ditolak.');
  });

  it('7. Memastikan password di-hash secara aman menggunakan bcrypt', () => {
    seedDatabase(db);

    const admin = db.prepare(`SELECT password_hash FROM users WHERE username = 'admin';`).get();
    assert.ok(admin, 'Admin harus ada.');
    assert.notStrictEqual(admin.password_hash, 'admin123', 'Password admin tidak boleh berupa plaintext.');
    assert.ok(admin.password_hash.startsWith('$2'), 'Hash harus berformat bcrypt.');

    // Verifikasi pencocokan password
    const isMatch = bcrypt.compareSync('admin123', admin.password_hash);
    const isWrongMatch = bcrypt.compareSync('wrong_pass', admin.password_hash);
    assert.strictEqual(isMatch, true, 'bcrypt compare harus true untuk password yang benar.');
    assert.strictEqual(isWrongMatch, false, 'bcrypt compare harus false untuk password yang salah.');
  });

  it('8. Memastikan migrasi dan seed bersifat idempoten (dijalankan berulang kali)', () => {
    // Jalankan seed pertama
    seedDatabase(db);
    const countUsers1 = db.prepare('SELECT count(*) as c FROM users;').get().c;
    const countDevices1 = db.prepare('SELECT count(*) as c FROM devices;').get().c;
    const countKelas1 = db.prepare('SELECT count(*) as c FROM kelas;').get().c;
    const countNilai1 = db.prepare('SELECT count(*) as c FROM nilai;').get().c;

    // Jalankan migrasi ulang dan seed kedua kali
    assert.doesNotThrow(() => {
      runMigrations(db);
      seedDatabase(db);
    }, 'Migrasi dan seed kedua kali tidak boleh melempar error.');

    const countUsers2 = db.prepare('SELECT count(*) as c FROM users;').get().c;
    const countDevices2 = db.prepare('SELECT count(*) as c FROM devices;').get().c;
    const countKelas2 = db.prepare('SELECT count(*) as c FROM kelas;').get().c;
    const countNilai2 = db.prepare('SELECT count(*) as c FROM nilai;').get().c;

    assert.strictEqual(countUsers1, countUsers2, 'Jumlah users tidak boleh bertambah saat re-seed.');
    assert.strictEqual(countDevices1, countDevices2, 'Jumlah devices tidak boleh bertambah saat re-seed.');
    assert.strictEqual(countKelas1, countKelas2, 'Jumlah kelas tidak boleh bertambah saat re-seed.');
    assert.strictEqual(countNilai1, countNilai2, 'Jumlah nilai tidak boleh bertambah saat re-seed.');
  });

  it('9. Memastikan data awal (seed) memenuhi ketentuan PDF', () => {
    seedDatabase(db);

    // Minimal 1 admin, 2 dosen, 3 mahasiswa
    const adminCount = db.prepare("SELECT count(*) as c FROM users WHERE role = 'admin';").get().c;
    const dosenCount = db.prepare("SELECT count(*) as c FROM users WHERE role = 'dosen';").get().c;
    const mhsCount = db.prepare("SELECT count(*) as c FROM users WHERE role = 'mahasiswa';").get().c;

    assert.ok(adminCount >= 1, 'Harus ada minimal 1 admin.');
    assert.ok(dosenCount >= 2, 'Harus ada minimal 2 dosen.');
    assert.ok(mhsCount >= 3, 'Harus ada minimal 3 mahasiswa.');

    // Minimal 2 kelas yang diampu oleh dosen berbeda
    const kelasRows = db.prepare('SELECT DISTINCT dosen_id FROM kelas;').all();
    assert.ok(kelasRows.length >= 2, 'Harus ada minimal 2 kelas dengan dosen pengampu yang berbeda.');

    // Setiap user memiliki minimal 1 device terdaftar
    const usersWithoutDevice = db.prepare(`
      SELECT u.id, u.username
      FROM users u
      LEFT JOIN devices d ON u.id = d.user_id
      WHERE d.id IS NULL;
    `).all();
    assert.strictEqual(usersWithoutDevice.length, 0, 'Setiap user wajib memiliki minimal 1 device terdaftar.');
  });
});
