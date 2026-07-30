import { createRoute } from '@hono/zod-openapi';
import { getSunTimes } from '../astronomy';
import { createRouter } from '../openapi-router';
import { SunTimesQuerySchema, SunTimesSchema } from '../schemas/sun-times';

/** Router mounted at /api/v1/sun-times. */
export const sunTimesRouter = createRouter();

/** GET / — FAA civil twilight boundaries, sunrise, and sunset for a date/lat/lon. Computed on demand; no database access. */
const sunTimesRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: SunTimesQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: SunTimesSchema } },
      description: 'Morning civil twilight begin, sunrise, sunset, and evening civil twilight end',
    },
  },
});

sunTimesRouter.openapi(sunTimesRoute, async (c) => {
  const { date, lat, lon } = c.req.valid('query');
  const sunTimes = getSunTimes(new Date(`${date}T00:00:00Z`), lat, lon);
  return c.json(sunTimes, 200);
});
