import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { logger } from './logger';

export const app = new OpenAPIHono();

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

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'Sensor Flight Log Service',
    version: '0.1.0',
  },
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

// Proves the OpenAPIHono + Zod validation wiring works end-to-end; replaced by real routes in Phase 6.
const echoRoute = createRoute({
  method: 'get',
  path: '/_openapi-check',
  request: {
    query: z.object({ echo: z.string().min(1).openapi({ example: 'hello' }) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ echo: z.string() }) } },
      description: 'Echoes the query param back',
    },
  },
});

app.openapi(echoRoute, (c) => {
  const { echo } = c.req.valid('query');
  return c.json({ echo }, 200);
});
