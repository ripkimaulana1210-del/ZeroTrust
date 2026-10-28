const { getDatabase } = require('../../database/connection');
const { createApp } = require('./app');
require('dotenv').config();

const PORT = parseInt(process.env.GATEWAY_PORT || '3000', 10);

function startServer() {
  const db = getDatabase();
  const app = createApp(db);

  const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  API Gateway PEP (NIST SP 800-207) Aktif di Port ${PORT}`);
    console.log(`  Health Check: http://localhost:${PORT}/health`);
    console.log(`  Forwarding Nilai     -> http://localhost:${process.env.SERVICE_NILAI_PORT || 3001}`);
    console.log(`  Forwarding Transkrip -> http://localhost:${process.env.SERVICE_TRANSKRIP_PORT || 3002}`);
    console.log(`=======================================================`);
  });

  function shutdown(signal) {
    console.log(`\n[GATEWAY] Menerima sinyal ${signal}. Menutup server secara anggun...`);
    server.close(() => {
      console.log('[GATEWAY] Server HTTP berhasil dimatikan.');
      try {
        db.close();
        console.log('[GATEWAY] Koneksi database SQLite ditutup.');
      } catch (e) {
        // Abaikan jika sudah tertutup
      }
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { server, db, app };
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
