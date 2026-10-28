const { getDatabase } = require('./connection');
const { runMigrations } = require('./schema');
const { seedDatabase } = require('./seed');

function init() {
  console.log('[INIT] Membuka koneksi database...');
  const db = getDatabase();

  try {
    console.log('[INIT] Menjalankan migrasi skema tabel & indeks...');
    runMigrations(db);

    console.log('[INIT] Mengisi seed data awal...');
    seedDatabase(db);

    console.log('[INIT] Inisialisasi database berhasil selesai!');
  } catch (error) {
    console.error('[INIT] Terjadi kesalahan saat inisialisasi database:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  init();
}

module.exports = { init };
