import { swaggerUI } from '@hono/swagger-ui';
import { HTTPException } from 'hono/http-exception';
import { logger } from './logger';
import { createRouter } from './openapi-router';
import { droneRegistrationsRouter, ownerDroneRegistrationsRouter } from './routes/drone-registrations';
import { ownersRouter } from './routes/owners';
import { pilotLookupRouter, pilotsRouter } from './routes/pilots';

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

/** Content-Type header pattern accepted for JSON request bodies. */
const JSON_CONTENT_TYPE = /^application\/([a-z-.]+\+)?json/;
/** HTTP methods whose requests are expected to carry a body. */
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

app.use('*', async (c, next) => {
  // @hono/zod-openapi only runs its JSON body validator when Content-Type matches
  // application/json — for any other (or missing) Content-Type on a body-carrying
  // request, it skips validation entirely rather than rejecting the request, and
  // the route handler proceeds as if the body were empty. Reject early and explicitly
  // instead to avoid some downstream error.
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
    title: 'Drone Registrations Service',
    version: '0.1.0',
  },
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

app.route('/api/v1/owners', ownersRouter);
app.route('/api/v1/owners/:ownerId/pilots', pilotsRouter);
app.route('/api/v1/pilots', pilotLookupRouter);
app.route('/api/v1/owners/:ownerId/drone-registrations', ownerDroneRegistrationsRouter);
app.route('/api/v1/drone-registrations', droneRegistrationsRouter);
