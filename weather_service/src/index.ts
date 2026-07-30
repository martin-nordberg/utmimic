import { app } from './app';

// Phase 1 scaffolding only: port is a bare env read here, replaced by the
// validated src/config.ts (with a default of 8000) in Phase 2.
const port = Number(process.env.PORT) || 8000;

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`weather_service listening on port ${port}`);
