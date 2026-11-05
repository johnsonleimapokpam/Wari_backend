const http = require('http');
const app = require('./src/app');
const { env } = require('./src/config/env');
const { pool } = require('./src/config/db');
const { initializeSocketServer } = require('./src/sockets/socketServer');
const redisClient = require("./src/config/redis")

const httpServer = http.createServer(app);
const io = initializeSocketServer(httpServer);
let server;

async function bootstrap(){
  await redisClient.connect();

  await pool.query('SELECT 1');
  console.log("Postgres Connected");

  server = httpServer.listen(env.PORT, () => {
    console.log(`API server listening on port ${env.PORT}`);
  });
}

const shutdown = async () => {
  io.close();

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  if (redisClient.isOpen) {
    await redisClient.quit();
  }

  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
