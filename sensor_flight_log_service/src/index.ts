import { app } from './app';

const port = 8004;

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`sensor_flight_log_service listening on port ${port}`);
