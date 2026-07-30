import { Hono } from 'hono';
import { logger } from './logger';

/** The service's root Hono app: middleware, error handling, docs, and route mounts. */
export const app = new Hono();

app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: performance.now() - start,
  });
});

app.get('/healthz', (c) => c.body(null, 200));
