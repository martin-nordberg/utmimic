import { runMigrations } from '../migrations/run';
import { app } from './app';
import { config } from './config';
import { sql } from './db';
import { logger } from './logger';

await runMigrations();

/** HTTP server for the service, started after migrations have run. */
const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info(`sensor_flight_log_service listening on port ${config.PORT}`);

/** Stops accepting connections and drains the database pool before exiting. */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.stop();
  await sql.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
