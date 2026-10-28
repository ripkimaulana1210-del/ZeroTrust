const { getDatabase } = require('./connection');
const { dropAllTables, runMigrations } = require('./schema');
const { seedDatabase } = require('./seed');

function reset() {
  console.log('[RESET] Membuka koneksi database...');
  const db = getDatabase();

  try {
    console.log('[RESET] Menghapus seluruh tabel dan me-reset sequence SQLite...');
    dropAllTables(db);

    console.log('[RESET] Menjalankan ulang migrasi skema tabel & indeks...');
    runMigrations(db);

    console.log('[RESET] Mengisi ulang seed data awal...');
    seedDatabase(db);

    console.log('[RESET] Reset database berhasil selesai!');
  } catch (error) {
    console.error('[RESET] Terjadi kesalahan saat reset database:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  reset();
}

module.exports = { reset };
