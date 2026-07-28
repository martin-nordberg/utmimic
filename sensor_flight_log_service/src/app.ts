import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { logger } from './logger';
import { positionsRouter } from './routes/positions';
import { profilesRouter } from './routes/profiles';
import { sensorsRouter } from './routes/sensors';

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

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  logger.error(err);
  return c.json({ message: 'Internal Server Error' }, 500);
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
