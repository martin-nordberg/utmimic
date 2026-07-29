import { swaggerUI } from '@hono/swagger-ui';
import { HTTPException } from 'hono/http-exception';
import { logger } from './logger';
import { createRouter } from './openapi-router';
import { positionsRouter } from './routes/positions';
import { profilesRouter } from './routes/profiles';
import { sensorsRouter } from './routes/sensors';

/** The service's root Hono app: middleware, error handling, docs, and route mounts. */
export const app = createRouter();

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

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  logger.error(err);
  return c.json({ message: 'Internal Server Error' }, 500);
});

// @hono/zod-openapi only runs its JSON body validator when Content-Type matches
// application/json — for any other (or missing) Content-Type on a body-carrying
// request, it skips validation entirely rather than rejecting the request, and
// the route handler proceeds as if the body were empty. Depending on the route
// that silently produces a 500 (fields arrive undefined, hitting a NOT NULL
// constraint), a confusing error, or — worst — a 200 that silently discards the
// caller's actual data (e.g. PUT profile "succeeding" by storing {} instead of
// the submitted body). Reject early and explicitly instead.
/** Content-Type header pattern accepted for JSON request bodies. */
const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json/;
/** HTTP methods whose requests are expected to carry a body. */
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

app.use('*', async (c, next) => {
  if (METHODS_WITH_BODY.has(c.req.method)) {
    const contentType = c.req.header('content-type');
    if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
      return c.json({ message: 'Content-Type must be application/json' }, 415);
    }
  }
  await next();
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

app.route('/api/v1/sensors', sensorsRouter);
app.route('/api/v1/sensors/:sensorId/profile', profilesRouter);
app.route('/api/v1/drones/:serial/positions', positionsRouter);
