import { app } from './app';
import { config } from './config';
import { logger } from './logger';

Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

logger.info(`sensor_flight_log_service listening on port ${config.PORT}`);
