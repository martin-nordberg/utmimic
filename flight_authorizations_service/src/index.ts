import { app } from './app';
import { config } from './config';
import { sql } from './db';
import { logger } from './logger';

/** HTTP server for the service. */
const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info(`flight_authorizations_service listening on port ${config.PORT}`);

/** Stops accepting connections and drains the database pool before exiting. */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.stop();
  await sql.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
