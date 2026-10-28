const { getDatabase } = require('../../database/connection');
const { createNilaiApp } = require('./app');
require('dotenv').config();

function startServer() {
  const db = getDatabase();
  const port = Number(process.env.SERVICE_NILAI_PORT || 3001);
  const app = createNilaiApp(db);
  const server = app.listen(port, '127.0.0.1', () => console.log(`[SERVICE_NILAI] listening on 127.0.0.1:${port}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { app, server, db };
}
if (require.main === module) startServer();
module.exports = { startServer };
