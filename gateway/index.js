const { startServer } = require('./src/server');

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
