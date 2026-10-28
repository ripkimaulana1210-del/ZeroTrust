const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

/**
 * Mendapatkan instance koneksi database SQLite.
 * @param {string} [customPath] - Path kustom untuk database (opsional, misalnya ':memory:' untuk testing)
 * @returns {import('better-sqlite3').Database}
 */
function getDatabase(customPath) {
  const configuredPath = customPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'database.sqlite');
  let targetPath = configuredPath;

  if (configuredPath !== ':memory:') {
    const projectRoot = path.resolve(__dirname, '..');
    const dataDirectory = path.join(projectRoot, 'data');
    // Resolve relative paths from project root; DATABASE_PATH cannot escape data/.
    const resolvedPath = path.isAbsolute(configuredPath)
      ? path.resolve(configuredPath)
      : path.resolve(projectRoot, configuredPath);
    const relativeToData = path.relative(dataDirectory, resolvedPath);
    if (relativeToData.startsWith('..') || path.isAbsolute(relativeToData)) {
      throw new Error('DATABASE_PATH harus berada di dalam folder proyek data/.');
    }
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
    // Use the same canonical absolute path for opening SQLite.
    targetPath = resolvedPath;
  }

  const db = new Database(targetPath);

  // Wajib aktifkan foreign keys di SQLite pada setiap koneksi
  db.pragma('foreign_keys = ON');

  // Gunakan Write-Ahead Logging untuk performa konkurensi lebih baik
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  return db;
}

module.exports = {
  getDatabase
};
