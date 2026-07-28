import { runMigrations } from '../migrations/run';
import { app } from './app';
import { config } from './config';
import { logger } from './logger';

await runMigrations();

Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info(`sensor_flight_log_service listening on port ${config.PORT}`);
